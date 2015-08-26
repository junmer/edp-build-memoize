# edp-build-memoize

> edp-build memoize

## Usage

`edp-build-config.js`:

```js
var MemoizeProcessor = require('edp-build-memoize');

exports.getProcessors = function () {
    
    var jsProcessor = new JsCompressor();
    jsProcessor = new MemoizeProcessor(jsProcessor, {
        name: 'jscompress',
        files: ['*.js']
    });

    return [jsProcessor];

});
```

## Related

- [edp](https://github.com/ecomfe/edp)

[![NPM](https://nodei.co/npm/edp-build-memoize.png?downloads=true&stars=true)](https://nodei.co/npm/edp-build-memoize/)
