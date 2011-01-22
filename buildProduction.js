#!/usr/bin/env node

var path = require('path'),
    fs = require('fs'),
    step = require('step'),
    _ = require('underscore'),
    fileUtils = require('./fileUtils'),
    transforms = require('./transforms'),
    SiteGraph = require('./SiteGraph'),
    error = require('./error'),
    commandLineOptions = require('./camelOptimist')({usage: 'FIXME', demand: ['root', 'out-root', 'static-url']}),
    siteGraph = new SiteGraph({root: commandLineOptions.root}),
    htmlAssets = [];

step(
    function () {
        var group = this.group();
        commandLineOptions._.forEach(function (htmlUrl) {
            var htmlAsset = siteGraph.loadAsset({type: 'HTML', url: htmlUrl});
            htmlAssets.push(htmlAsset);
            siteGraph.populate(htmlAsset, function (relation) {
                return relation.type !== 'JavaScriptStaticInclude';
            }, group());
        });
        fileUtils.mkpath(path.join(commandLineOptions.outRoot, commandLineOptions.staticUrl), this.parallel());
    },
    error.logAndExit(function () {
        transforms.bundleRelations(siteGraph, siteGraph.relations.filter(function (relation) {
            return relation.from === htmlAssets[0] && relation.type === 'HTMLScript';
        }), this.parallel());
        transforms.bundleRelations(siteGraph, siteGraph.relations.filter(function (relation) {
            return relation.from === htmlAssets[0] && relation.type === 'HTMLStyle';
        }), this.parallel());
    }),
    error.logAndExit(function () {
        transforms.spriteBackgroundImages(siteGraph, this);
    }),
    error.logAndExit(function () {
        transforms.checkRelationConsistency(siteGraph, this);
    }),
    error.logAndExit(function () {
        // FIXME
        siteGraph.assets.forEach(function (asset) {
            if (htmlAssets.indexOf(asset) === -1) {
                siteGraph.setAssetUrl(asset, path.join(commandLineOptions.staticUrl, "foo"));
            }
        });
        process.nextTick(this);
    }),
    error.logAndExit(function () {
        transforms.addCacheManifest(siteGraph, htmlAssets[0], this);
    }),
    error.logAndExit(function () {
        transforms.findAssetSerializationOrder(siteGraph, this);
    }),
    error.logAndExit(function (assetSerializationOrderGroups) {
        function serializeAssets(assets, cb) {
            step(
                function () {
                    var group = this.group();
                    assets.forEach(function (asset) {
                        // Move + write only if asset has non-inline incoming relations
                        if (htmlAssets.indexOf(asset) !== -1 || siteGraph.findRelations('to', asset).some(function (relation) {return !relation.isInline;})) {
                            var callback = group();
                            asset.serialize(error.passToFunction(callback, function (src) {
                                if (htmlAssets.indexOf(asset) === -1) {
                                    var md5Prefix = require('crypto').createHash('md5').update(src).digest('hex').substr(0, 10);
                                    siteGraph.setAssetUrl(asset, path.join(commandLineOptions.staticUrl, md5Prefix + '.' + asset.defaultExtension));
                                }
                                fs.writeFile(path.join(commandLineOptions.outRoot, asset.url), src, asset.encoding, callback);
                            }));
                        }
                    }, this);
                    process.nextTick(group());
                },
                cb
            );
        }
        var callback = this;
        function proceed() {
            if (assetSerializationOrderGroups.length) {
                serializeAssets(assetSerializationOrderGroups.shift(), proceed);
            } else {
                callback();
            }
        }
        proceed();
   })
);