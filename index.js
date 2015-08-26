/**
 * @file edp-build memoize
 * @author junmer
 */

/* eslint-env node */

var fs = require('fs');
var edp = require('edp-core');
var extend = edp.util.extend;

var FileInfo = require('./lib/file-info');

var beforeProcessor = {
    name: 'before',
    process: function (file, processContext, done) {

        var cacheContext = this.cache;

        var cacheFile = cacheContext.getFileByPath(file.path);

        if (cacheFile.md5sum() === file.md5sum()) {
            processContext.removeFile(file.path);
        }
        else {
            cacheContext.removeFile(file.path);
            cacheContext._removedFiles.push(file.path);
        }

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
                data: file.data
            })
        );

        cacheContext._addedFiles.push(file.path);

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
                        data: file.data
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

        if (stat.isDirectory()) {
            traverseDir(file, processContext);
        }
        else {
            var fileEncodings = processContext.fileEncodings;
            var fileEncoding = null;
            for (var encodingPath in fileEncodings) {
                if (helper.satisfy(relativePath, encodingPath)) {
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

        var baseDir = processContext.baseDir;
        var cacheDir = edp.path.resolve(baseDir, me.cachePath, me.name);

        // cacheContext
        var ProcessContext = processContext.constructor;

        var cacheContext = new ProcessContext({
            baseDir: cacheDir,
            output: cacheDir,
            fileEncodings: processContext.fileEncodings
        });

        cacheContext._removedFiles = [];
        cacheContext._addedFiles = [];

        me.cache = traverseDir(cacheDir, cacheContext);

        // processors
        var processors = me.processors;
        processors = Array.isArray(processors) ? processors: [processors];

        // before
        processors.unshift(
            extend(
                beforeProcessor,
                {
                    name: 'Before: ' + me.name,
                    cache: me.cache
                }
            )
        );

        // after
        processors.push(
            extend(
                afterProcessor,
                {
                    name: 'After: ' + me.name,
                    cache: me.cache
                }
            )
        );

        // save cache
        function cacheFiles () {

            var outputDir = cacheContext.outputDir;

            cacheContext._removedFiles.forEach(function (outputPath) {

                var outputFile = edp.path.resolve(outputDir, outputPath);
                if (fs.existsSync(outputFile)) {
                    fs.unlinkSync(outputFile);
                }

            });

            var mkdirp = require('mkdirp');
            cacheContext._addedFiles.forEach(function (outputPath) {

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

            done();
        }

        // process
        var processorIndex = 0;
        var processorCount = processors.length;

        function nextProcess() {
            if ( processorIndex >= processorCount ) {
                cacheFiles();
                return;
            }

            var processor = processors[ processorIndex++ ];
            if ( !(processor instanceof ProcessorBase) ) {
                processor = new ProcessorBase( processor );
            }

            edp.log.info( 'Running ' + processor.name );
            if ( processor.start ) {
                processor.start( processContext, nextProcess );
            }
            else {
                nextProcess();
            }
        }

        nextProcess();

    }
},

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
        {
            processors: processors,
            cachePath: '.edp-memoize'
        },
        opt
    );
}

module.exports = exports = MemoizeProcessor;
