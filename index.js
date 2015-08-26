/**
 * @file edp-build memoize
 * @author junmer
 */

/* eslint-env node */

var fs = require('fs');
var mkdirp = require('mkdirp');
var edp = require('edp-core');
var extend = edp.util.extend;

var FileInfo = require('./lib/file-info');

var beforeProcessor = {
    name: 'before',
    process: function (file, processContext, done) {

        var cacheContext = this.cache;

        var cacheFile = cacheContext.getFileByPath(file.path);

        if (cacheFile && cacheFile.get('md5sum') === file.md5sum()) {
            processContext.removeFile(file.path);
        }
        else {
            cacheContext.removeFile(file.path);
            cacheContext._removedFiles.push(file);
        }

        cacheContext._sourceFiles.push({
            path: file.path,
            md5sum: file.md5sum()
        });

        done();
    }
};

var afterProcessor = {
    name: 'after',
    process: function (file, processContext, done) {

        var cacheContext = this.cache;

        var baseDir = cacheContext.baseDir;

        cacheContext.addFile(
            new FileInfo({
                path: file.path,
                fullPath: edp.path.resolve(baseDir, file.path),
                extname: file.extname,
                data: file.data,
                fileEncoding: file.fileEncoding
            })
        );

        cacheContext._addedFiles.push(file);

        done();

    },
    afterAll: function (processContext) {

        var baseDir = processContext.baseDir;

        var cacheContext = this.cache;

        cacheContext
            .getFiles()
            .forEach(function (file) {

                processContext.addFile(
                    new FileInfo({
                        path: file.path,
                        fullPath: edp.path.resolve(baseDir, file.path),
                        extname: file.extname,
                        data: file.data,
                        fileEncoding: file.fileEncoding
                    })
                );

            });

    }
};


/**
 * 遍历目录
 *
 * @inner
 * @param {string|Array.<string>} dir 目录路径
 * @param {ProcessContext} processContext 构建环境对象
 */
function traverseDir(dir, processContext) {
    if (Array.isArray(dir)) {
        dir.forEach(function (item) {
            traverseDir(item, processContext);
        });
        return;
    }

    var files = fs.readdirSync(dir);


    files.forEach(function (file) {
        if (file === '.svn' || file === '.git') {
            return;
        }

        file = edp.path.resolve(dir, file);
        var stat = fs.statSync(file);
        var relativePath = edp.path.relative(processContext.baseDir, file);

        if (stat.isDirectory()) {
            traverseDir(file, processContext);
        }
        else {
            var fileEncodings = processContext.fileEncodings;
            var fileEncoding = null;
            for (var encodingPath in fileEncodings) {
                if (edp.path.satisfy(relativePath, encodingPath)) {
                    fileEncoding = fileEncodings[encodingPath];
                    break;
                }
            }

            var fileData = new FileInfo({
                data: fs.readFileSync(file),
                extname: edp.path.extname(file).slice(1),
                path: relativePath,
                fullPath: file,
                fileEncoding: fileEncoding
            });
            processContext.addFile(fileData);
        }
    });
}

var memoizeProcessor = {
    name: 'MemoizeProcessor',
    start: function (processContext, done) {

        var me = this;

        this.beforeAll(processContext);

        var baseDir = processContext.baseDir;
        var memDir = edp.path.resolve(baseDir, me.cachePath, 'memoize');
        var cacheDir = edp.path.resolve(memDir, me.name);
        var cacheJSON = edp.path.resolve(memDir, me.name + '.json');

        mkdirp.sync(cacheDir);

        // cacheContext
        var ProcessContext = processContext.constructor;

        var cacheContext = new ProcessContext({
            baseDir: cacheDir,
            outputDir: cacheDir,
            fileEncodings: processContext.fileEncodings
        });

        cacheContext._sourceFiles = [];
        cacheContext._removedFiles = [];
        cacheContext._addedFiles = [];

        traverseDir(cacheDir, cacheContext);

        if (fs.existsSync(cacheJSON)) {

            var cacheMap = edp.util.readJSONFile(cacheJSON);

            cacheContext.getFiles().forEach(function (file) {
                if (cacheMap[file.path]) {
                    file.set('md5sum', cacheMap[file.path]);
                }
            });
        }

        // processors
        var processors = me.processors;
        processors = Array.isArray(processors) ? processors : [processors];

        // before
        processors.unshift(
            extend(
                beforeProcessor,
                {
                    name: 'Before: ' + me.name,
                    cache: cacheContext
                }
            )
        );

        // after
        processors.push(
            extend(
                afterProcessor,
                {
                    name: 'After: ' + me.name,
                    cache: cacheContext
                }
            )
        );

        // save cache
        function cacheFiles() {

            var outputDir = cacheContext.outputDir;

            cacheContext._removedFiles.forEach(function (file) {

                if (file.outputPath) {
                    var outputFile = edp.path.resolve(outputDir, file.outputPath);
                    if (fs.existsSync(outputFile)) {
                        fs.unlinkSync(outputFile);
                    }
                }

            });


            cacheContext._addedFiles.forEach(function (file) {

                if (file.outputPath) {
                    var fileBuffer = file.getDataBuffer();

                    file.outputPaths.push(file.outputPath);
                    file.outputPaths.forEach(function (outputPath) {

                        var outputFile = edp.path.resolve(outputDir, outputPath);
                        mkdirp.sync(edp.path.dirname(outputFile));
                        fs.writeFileSync(outputFile, fileBuffer);
                    });
                }

            });

            var cacheMap = {};

            cacheContext._sourceFiles.forEach(function (file) {
                cacheMap[file.path] = file.md5sum;
            });

            fs.writeFileSync(cacheJSON, JSON.stringify(cacheMap, null, 4), 'UTF-8');

            done();
        }

        // process
        var ProcessorBase = me.constructor;
        var processorIndex = 0;
        var processorCount = processors.length;

        function nextProcess() {
            if (processorIndex >= processorCount) {
                cacheFiles();
                return;
            }

            var processor = processors[processorIndex++];
            if (!(processor instanceof ProcessorBase)) {
                processor = new ProcessorBase(processor);
            }

            edp.log.info('Running ' + processor.name);
            if (processor.start) {
                processor.start(processContext, nextProcess);
            }
            else {
                nextProcess();
            }
        }

        nextProcess();

    }
};

/**
 * MemoizeProcessor 构造函数
 *
 * @param {Array|Processor} processors 处理器实例
 * @param {Object} opt 配置
 * @param {Array} opt.name 处理器名称
 * @return {Object} MemoizeProcessor instance
 */

function MemoizeProcessor(processors, opt) {

    return extend(
        memoizeProcessor,
        {
            processors: processors,
            cachePath: '.edpproj'
        },
        opt
    );
}

module.exports = exports = MemoizeProcessor;
