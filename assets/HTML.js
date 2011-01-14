var util = require('util'),
    _ = require('underscore'),
    jsdom = require('jsdom'),
    error = require('../error'),
    makeBufferedAccessor = require('../makeBufferedAccessor'),
    relations = require('../relations'),
    Base = require('./Base').Base;

function HTML(config) {
    Base.call(this, config);
}

util.inherits(HTML, Base);

_.extend(HTML.prototype, {
    getParseTree: makeBufferedAccessor('parseTree', function (cb) {
        var that = this;
        this.getOriginalSrc(error.passToFunction(cb, function (src) {
            that.parseTree = jsdom.jsdom(src, undefined, {features: {ProcessExternalResources: [], FetchExternalResources: []}});
            cb(null, that.parseTree);
        }));
    }),

    getOriginalRelations: makeBufferedAccessor('originalRelations', function (cb) {
        var that = this;
        this.getParseTree(error.passToFunction(cb, function (parseTree) {
            var originalRelations = [];
            _.toArray(parseTree.getElementsByTagName('*')).forEach(function (node) {
                var nodeName = node.nodeName.toLowerCase();
                if (nodeName === 'script') {
                    if (node.src) {
                        originalRelations.push(new relations.HTMLScript({
                            from: that,
                            node: node,
                            assetConfig: {
                                url: node.src
                            }
                        }));
                    } else {
                        originalRelations.push(new relations.HTMLScript({
                            from: that,
                            node: node,
                            assetConfig: {
                                type: 'JavaScript',
                                originalSrc: node.firstChild.nodeValue
                            }
                        }));
                    }
                } else if (nodeName === 'style') {
                    originalRelations.push(new relations.HTMLStyle({
                        from: that,
                        node: node,
                        assetConfig: {
                            type: 'CSS',
                            originalSrc: node.firstChild.nodeValue
                        }
                    }));
                } else if (nodeName === 'link') {
                    if ('rel' in node) {
                        var rel = node.rel.toLowerCase();
                        if (rel === 'stylesheet') {
                            originalRelations.push(new relations.HTMLStyle({
                                from: that,
                                node: node,
                                assetConfig: {
                                    url: node.href
                                }
                           }));
                        } else if (/^(?:shortcut |apple-touch-)?icon$/.test(rel)) {
                            originalRelations.push(new relations.HTMLShortcutIcon({
                                from: that,
                                node: node,
                                assetConfig: {
                                    url: node.href
                                }
                            }));
                        }
                    }
                } else if (nodeName === 'img') {
                    originalRelations.push(new relations.HTMLImage({
                        from: that,
                        node: node,
                        assetConfig: {
                            url: node.src
                        }
                    }));
                } else if (nodeName === 'iframe') {
                    originalRelations.push(new relations.HTMLIFrame({
                        from: that,
                        node: node,
                        assetConfig: {
                            url: node.src
                        }
                    }));
                }
            }, this);
            cb(null, originalRelations);
        }));
    }),

    attachRelation: function (relation, position, adjacentRelation) {
        position = position || 'first';
        _.extend(relation, {
            from: this,
            node: relation.createNode(this.parseTree)
        });

        if (position === 'first') {
            if (relation.type === 'HTMLStyle') {
                this.parseTree.head.appendChild(relation.node);
            } else {
                throw "HTML.attachRelation: position=first only supported for CSS assets";
            }
        } else { // 'before' or 'after'
            var parentNode = adjacentRelation.node.parentNode;
            if (position === 'after') {
                parentNode.insertBefore(relation.node, adjacentRelation.node.nextSibling);
            } else {
                parentNode.insertBefore(relation.node, adjacentRelation.node);
            }
        }
    },

    detachRelation: function (relation) {
        relation.node.parentNode.removeChild(relation.node);
        delete relation.node;
    }
});

exports.HTML = HTML;
