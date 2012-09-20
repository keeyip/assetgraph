/*global require, exports*/
var util = require('util'),
    _ = require('underscore'),
    extendWithGettersAndSetters = require('../util/extendWithGettersAndSetters'),
    Relation = require('./Relation');

function JavaScriptAmdRequire(config) {
    Relation.call(this, config);
}

util.inherits(JavaScriptAmdRequire, Relation);

extendWithGettersAndSetters(JavaScriptAmdRequire.prototype, {
    get baseAssetQuery() {
        var that = this;
        return function (asset) {
            // http://requirejs.org/docs/api.html#jsfiles
            // A .js extension indicates that the href is relative to the Html asset:
            if (/\.js$/.test(that.node[1])) {
                return asset.type === 'Html';
            } else {
                // Relative to the main module: Find the first JavaScript with an incoming HtmlRequireJsMain relation,
                // and stop if encountering an Html asset, just to be safe:
                return asset.type === 'Html' || (asset.type === 'JavaScript' && asset.incomingRelations.some(function (incomingRelation) {
                    return incomingRelation.type === 'HtmlRequireJsMain';
                }));
            }
        };
    },

    get href() {
        var href = this.node[1].replace(/^(?:[^!]*!)?(?:\.\/)?/, ""); // Strip foo! prefix and ./
        if (!/^text!/.test(this.node[1]) && !/\.(?:ko|txt|js|json|css|less)$/.test(href)) { // Hmm, this cannot be the correct criterion
            href += ".js";
        }
        return href;
    },

    set href(href) {
        var matchExistingPrefix = this.node[1].match(/^([^!]*\!)?(.*)$/),
            existingPrefix = '',
            existingHrefWithoutPrefix;
        if (matchExistingPrefix) {
            existingPrefix = matchExistingPrefix[1] || '';
            existingHrefWithoutPrefix = matchExistingPrefix[2];
        }
        var existingHrefIsModuleRelative = !/^(?:\/|https?:)|\.js$/.test(existingHrefWithoutPrefix);

        if (existingHrefIsModuleRelative) {
            this.node[1] = existingPrefix + href;
        } else {
            this.node[1] = existingPrefix + href.replace(/\.js$/, '');
        }
    },

    inline: function () {
        throw new Error("JavaScriptAmdRequire.inline(): Not supported");
    },

    attach: function (asset, position, adjacentRelation) {
        throw new Error("JavaScriptAmdRequire.attach(): Not supported");
    },

    detach: function () {
        var i = this.arrayNode[1].indexOf(this.node);
        if (i === -1) {
            throw new Error("relations.JavaScriptAmdRequire.detach: this.node not found in module array of this.requireCallNode.");
        }
        this.arrayNode[1].splice(i, 1);
        var argumentsNode = this.callNode[2],
            functionNode = argumentsNode[argumentsNode.length - 1];
        functionNode[2].splice(i, 1);
        return Relation.prototype.detach.call(this);
    },

    refreshHref: function () {
        // Doesn't make any sense for module names, so don't do anything unless the current href has an extension:
        if (/\.\w+$/.test(this.node[1])) {
            Relation.prototype.refreshHref.call(this);
        }
    }
});

module.exports = JavaScriptAmdRequire;
