/*global require, exports*/
var util = require('util'),
    _ = require('underscore'),
    extendWithGettersAndSetters = require('../util/extendWithGettersAndSetters'),
    Relation = require('./Relation');

function JavaScriptAngularJsTemplate(config) {
    Relation.call(this, config);
}

util.inherits(JavaScriptAngularJsTemplate, Relation);

extendWithGettersAndSetters(JavaScriptAngularJsTemplate.prototype, {
    baseAssetQuery: {type: 'Html', isInline: false, isFragment: false},

    inline: function () {
        this.node[0] = 'template';
        this.node[1][1] = this.to.text;
        Relation.prototype.inline.call(this);
        this.from.markDirty();
        return this;
    },

    set href(href) {
        this.node[1] = ['string', href];
    },

    get href() {
        return this.node[1][1];
    },

    attach: function (asset, position, adjacentRelation) {
        throw new Error("JavaScriptAngularJsTemplate.attach: Not implemented");
    },

    detach: function () {
        throw new Error("JavaScriptAngularJsTemplate.detach: Not implemented");
    }
});

module.exports = JavaScriptAngularJsTemplate;
