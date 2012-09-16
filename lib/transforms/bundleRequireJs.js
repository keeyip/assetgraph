var _ = require('underscore'),
    urlTools = require('../util/urlTools'),
    vm = require('vm'),
    uglifyJs = require('uglify-js-papandreou'),
    uglifyAst = require('uglifyast');

module.exports = function (queryObj) {
    return function bundleRequireJs(assetGraph) {
        var requireJsConfig = assetGraph.requireJsConfig || {paths: {}},
            assetsToCleanUp = [];
        assetGraph.findAssets(_.extend({type: 'Html'}, queryObj)).forEach(function (htmlAsset) {
            var existingHtmlStyleRelations = assetGraph.findRelations({type: 'HtmlStyle', from: htmlAsset}, true), // includeUnpopulated
                htmlStyleInsertionPoint;
            if (existingHtmlStyleRelations.length > 0) {
                htmlStyleInsertionPoint = existingHtmlStyleRelations[existingHtmlStyleRelations.length - 1];
            }

            assetGraph.findRelations({from: htmlAsset, type: ['HtmlRequireJsMain', 'HtmlScript']}).forEach(function (startRelation) {

                // Don't do anything for regular scripts that don't use require:
                if (startRelation.type === 'HtmlScript' && assetGraph.findRelations({from: startRelation.to, type: 'JavaScriptAmdRequire'}).length === 0) {
                    return;
                }

                var baseUrl = (requireJsConfig.baseUrl && requireJsConfig.baseUrl.replace(/\/$/, '')) || (startRelation.to.url || htmlAsset.url).replace(/[^\/]+$/, ''),
                    modulePrefixByPath = {},
                    modulePaths = [];

                Object.keys(requireJsConfig.paths).forEach(function (modulePrefix) {
                    var modulePath = requireJsConfig.paths[modulePrefix].replace(baseUrl, "").replace(/\/$/, '');
                    modulePrefixByPath[modulePath] = modulePrefix;
                    modulePaths.push(modulePath);
                });
                var modulePathsOrderedByLengthDesc = modulePaths.sort(function (a, b) {
                    return b.length - a.length;
                });

                function getModuleName(asset) {
                    var moduleName = urlTools.buildRelativeUrl(baseUrl, asset.url).replace(/\.js$/, "");
                    for (var i = 0 ; i < modulePathsOrderedByLengthDesc.length ; i += 1) {
                        var path = modulePathsOrderedByLengthDesc[i];
                        if (moduleName.indexOf(path + "/") === 0) {
                            moduleName = moduleName.replace(path, modulePrefixByPath[path]);
                            break;
                        }
                    }
                    return moduleName;
                }

                var outgoingRelations = [],
                    assetsToBundle = [],
                    bundleTopLevelStatements = [],
                    clonedAssetByAssetId = {};

                assetGraph.eachAssetPostOrder(startRelation, {type: ['JavaScriptAmdRequire', 'JavaScriptAmdDefine']}, function (asset) {
                    if (asset.type === 'JavaScript') {
                        assetsToCleanUp.push(asset);
                        var clonedAsset = asset.clone();
                        clonedAssetByAssetId[asset.id] = clonedAsset;
                        assetsToBundle.push(clonedAsset);
                    }
                });

                assetGraph.eachAssetPostOrder(startRelation, {type: ['JavaScriptAmdRequire', 'JavaScriptAmdDefine']}, function (asset, incomingRelation) {
                    var clonedAsset = clonedAssetByAssetId[asset.id],
                        moduleName;
                    if (!asset.isInline) {
                        moduleName = getModuleName(asset, htmlAsset);
                        if (asset === startRelation.to) {
                            // Strip "scripts/" prefix of the main module (hmm, not sure?)
                            moduleName = moduleName.replace(/^.*\//, "");
                        }
                    }
                    var injectDefineStatementValueAst;
                    if (asset.type === 'JavaScript') {
                        if (moduleName) {
                            assetGraph.findRelations({from: clonedAsset}).forEach(function (outgoingRelation) {
                                if (!/^JavaScriptAmd(?:Require|Define)$/.test(outgoingRelation.type)) {
                                    outgoingRelations.push(outgoingRelation);
                                    assetGraph.removeRelation(outgoingRelation);
                                }
                            });

                            // Check for existing define() statements:
                            var hasFoundPlausibleDefineStatementValueAst = false,
                                topLevelStatements = clonedAsset.parseTree[1];

                            if (topLevelStatements.length === 1 && topLevelStatements[0][0] === 'stat' &&
                                topLevelStatements[0][1][0] === 'call' &&
                                topLevelStatements[0][1][1][0] === 'function' &&
                                topLevelStatements[0][1][1][3].length === 1 &&
                                topLevelStatements[0][1][1][3][0][0] === 'if') {

                                var numDefineStatements = 0,
                                    walker = uglifyJs.uglify.ast_walker();
                                walker.with_walkers({
                                    call: function (expr, args) {
                                        if (expr[0] === 'name' && expr[1] === 'define') {
                                            numDefineStatements += 1;
                                        }
                                    }
                                }, function () {
                                    walker.walk(topLevelStatements[0][1][1]);
                                });
                                if (numDefineStatements === 1) {
                                    var context = vm.createContext(),
                                        factory;
                                    context.define = function () {
                                        if (arguments.length > 0 && typeof arguments[arguments.length - 1] === 'function') {
                                            factory = arguments[arguments.length - 1];
                                        }
                                    };
                                    context.define.amd = {jQuery: true, multiversion: true, plugins: true};

                                    try {
                                        vm.runInContext(uglifyJs.uglify.gen_code(topLevelStatements[0]), context);
                                    } catch (e) {
                                        factory = false;
                                    }
                                    if (factory) {
                                        injectDefineStatementValueAst = uglifyAst.objToAst(factory);
                                        topLevelStatements = clonedAsset.parseTree[1] = [];
                                        hasFoundPlausibleDefineStatementValueAst = true;
                                    }
                                }
                            }
                            if (!hasFoundPlausibleDefineStatementValueAst) {
                                var callDefineAsts = [],
                                    walker = uglifyJs.uglify.ast_walker();
                                walker.with_walkers({
                                    call: function (expr) {
                                        if (expr[0] === 'name' && expr[1] === 'define') {
                                            var stack = walker.stack();
                                            callDefineAsts.push(stack[stack.length - 1]);
                                        }
                                    }
                                }, function () {
                                    walker.walk(clonedAsset.parseTree);
                                });
                                if (callDefineAsts.length === 1) {
                                    var firstArgumentIsString = callDefineAsts[0][2].length > 0 && callDefineAsts[0][2][0][0] === 'string';
                                    callDefineAsts[0][2].splice(0, firstArgumentIsString ? 1 : 0, ['string', moduleName]);
                                    injectDefineStatementValueAst = null;
                                    hasFoundPlausibleDefineStatementValueAst = true;
                                }
                            }
                        }
                        Array.prototype.push.apply(bundleTopLevelStatements, clonedAsset.parseTree[1]);
                    } else if (/^JavaScriptAmd(?:Define|Require)$/.test(incomingRelation.type) && (asset.type === 'Css' || asset.type === 'Less')) {
                        var newHtmlStyle = new assetGraph.constructor.relations.HtmlStyle({to: asset});
                        if (htmlStyleInsertionPoint) {
                            newHtmlStyle.attach(htmlAsset, 'after', htmlStyleInsertionPoint);
                        } else {
                            newHtmlStyle.attach(htmlAsset, 'first');
                        }
                        htmlStyleInsertionPoint = newHtmlStyle;
                        assetGraph.findRelations({from: assetsToBundle, to: asset}).forEach(function (incomingRelation) {
                            incomingRelation.detach();
                        });
                    } else if (asset.isText) {
                        injectDefineStatementValueAst = ['call', ['name', 'GETTEXT'], [['string', '<urlGoesHere>']]];
                        var oneGetTextRelation = new assetGraph.constructor.relations.JavaScriptGetText({
                            node: injectDefineStatementValueAst,
                            from: incomingRelation.from,
                            to: asset
                        });
                        oneGetTextRelation.refreshHref();
                        assetGraph.addRelation(oneGetTextRelation);
                        outgoingRelations.push(oneGetTextRelation);

                        if (asset.type === 'KnockoutJsTemplate') {
                            injectDefineStatementValueAst = ['assign', true, ['sub', ['dot', ['dot', ['name', 'ko'], 'externalTemplateEngine'], 'templates'], ['string', moduleName.replace(/^.*\/|\.ko/g, '')]], injectDefineStatementValueAst];
                            assetGraph.findRelations({from: assetsToBundle, to: asset}).forEach(function (incomingRelation) {
console.warn("strip tpl");
                                incomingRelation.node[1] = incomingRelation.node[1].replace(/^tpl!/, '');
                            });
                        }

                        assetGraph.findRelations({from: assetsToBundle, to: asset, type: ['JavaScriptAmdDefine', 'JavaScriptAmdRequire']}).forEach(function (otherIncomingRelation) {
                            if (/^text!/.test(otherIncomingRelation.node[1])) {
console.warn("strip text");
                                otherIncomingRelation.node[1] = otherIncomingRelation.node[1].replace(/^text!/, "");
                                otherIncomingRelation.from.markDirty();
                            }
                        });
                    }
                    if (injectDefineStatementValueAst) {
                        bundleTopLevelStatements.push(['stat', ['call', ['name', 'define'], [['string', moduleName], injectDefineStatementValueAst]]]);
                    }
                });
                assetsToBundle.forEach(function (asset) {
                    if (asset.type === 'JavaScript' && asset !== startRelation.to) {
                        assetGraph.removeAsset(asset);
                    }
                });

                startRelation.to.replaceWith(new assetGraph.constructor.assets.JavaScript({
                    url: startRelation.to.url,
                    parseTree: ['toplevel', bundleTopLevelStatements],
                    outgoingRelations: outgoingRelations
                }));
                outgoingRelations.forEach(function (outgoingRelation) {
                    outgoingRelation.refreshHref();
                });
            });
        });
        assetsToCleanUp.forEach(function (asset) {
            if (asset.assetGraph && asset.incomingRelations.every(function (incomingRelation) {return assetsToCleanUp.indexOf(incomingRelation.from) !== -1;})) {
                assetGraph.removeAsset(asset);
            }
        });
        assetGraph.recomputeBaseAssets(true);
    };
};
