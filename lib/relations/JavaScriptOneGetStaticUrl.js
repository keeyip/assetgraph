/*global require, exports*/
var util = require('util'),
    _ = require('underscore'),
    uglifyAST = require('../util/uglifyAST'),
    query = require('../query'),
    Base = require('./Base');

function JavaScriptOneGetStaticUrl(config) {
    Base.call(this, config);
}

util.inherits(JavaScriptOneGetStaticUrl, Base);

_.extend(JavaScriptOneGetStaticUrl.prototype, {
    baseAssetQuery: {type: 'HTML', url: query.isDefined},

    _getRawUrlString: function () {
        return this.originalUrl || this.urlMap.originalUrl;
    },

    _setRawUrlString: function (url) {
        this.urlMap.mapExpandedUrl(this.originalUrl || this.urlMap.originalUrl, url);
        this.urlMap.node.splice(0, this.urlMap.node.length,
            'call',
            [
                'dot',
                [
                    'name',
                    'one'
                ],
                'getStaticUrl'
            ],
            [
                this.urlMap.toExpressionAST()
            ]
        );
    }
});

// Internal helper class that's currently a big mess:

// Requires: config.originalUrl (possibly containing wildcards)
// Optional: config.wildCardValueASTs
function UrlMap(config) {
    _.extend(this, config);
    this.expandedUrls = [];
    this.expandedUrlMapping = {};
}

UrlMap.prototype = {
    addExpandedUrl: function (expandedUrl) {
        this.expandedUrls.push(expandedUrl);
    },

    removeExpandedUrl: function (expandedUrl) {
        var index = this.expandedUrls.indexOf(expandedUrl);
        if (index !== -1) {
            this.expandedUrls.splice(index, 1);
            delete this.expandedUrlMapping[expandedUrl];
        } else {
            console.error("UrlMap.removeExpandedUrl: " + expandedUrl + " isn't in the map");
        }
    },

    mapExpandedUrl: function (expandedUrl, targetUrl) {
        this.expandedUrlMapping[expandedUrl] = targetUrl;
    },

    toExpressionAST: function () {
        if (this.wildCardValueASTs.length === 0) {
            return ['string', this.expandedUrlMapping[this.originalUrl] || this.originalUrl];
        } else {
            var wildCardLookupStructure = {},
                originalUrlRegExp = new RegExp(this.originalUrl.replace(/^[^\*]*?\//, "").replace(/\./g, "\\.").replace(/\*\*?/g, "([^\/]+)") + "$");
            this.expandedUrls.forEach(function (expandedUrl) {
                var matchWildCardValues = expandedUrl.match(originalUrlRegExp);
                if (matchWildCardValues) {
                    var wildCardValues = matchWildCardValues.slice(1),
                        cursor = wildCardLookupStructure;
                    wildCardValues.forEach(function (wildCardValue, i) {
                        if (i === wildCardValues.length - 1) {
                            cursor[wildCardValue] = this.expandedUrlMapping[expandedUrl] || expandedUrl;
                        } else {
                            if (!(wildCardValue in cursor)) {
                                cursor[wildCardValue] = {};
                            }
                            cursor = cursor[wildCardValue];
                        }
                    }, this);
                } else {
                    throw new Error("UrlMap.toExpressionAST: Couldn't match wild card values in " + expandedUrl + " using " + originalUrlRegExp.source);
                }
            }, this);
            var expressionAST = uglifyAST.objToAST(wildCardLookupStructure);
            this.wildCardValueASTs.forEach(function (wildCardValueAST) {
                expressionAST = ['sub', expressionAST, wildCardValueAST];
            });
            return expressionAST;
        }
    }
};

// Reconstuct UrlMap from the AST output of toExpressionAST:
//
// [ 'sub'
// , [ 'sub'
//   , [ 'object'
//     , [ [ 'json'
//         , [ 'object'
//           , [ [ 'a', [ 'string', 'json/a.json' ] ]
//             , [ 'b', [ 'string', 'json/b.json' ] ]
//             ]
//           ]
//         ]
//       ]
//     ]
//   , [ 'string', 'json' ]
//   ]
// , [ 'name', 'theOneToGet' ]
// ]

UrlMap.fromExpressionAST = function (ast) {
    var wildCardValueASTs = [],
        fakeOriginalUrl = "_",
        cursor = ast;

    while (cursor[0] === 'sub') {
        wildCardValueASTs.push(cursor[2]);
        cursor = cursor[1];
        fakeOriginalUrl += "/*";
    }

    var urlMap = new UrlMap({originalUrl: fakeOriginalUrl, wildCardValueASTs: wildCardValueASTs}),
        keys = [];
    function traverse(node) {
        if (keys.length < wildCardValueASTs.length) {
            if (node && node[0] === 'object') {
                for (var i = 0 ; i < node[1].length ; i += 1) {
                    keys.push(node[1][i][0]);
                    traverse(node[1][i][1]);
                    keys.pop();
                }
            } else {
                throw new Error("Invalid getStaticUrl syntax");
            }
        } else if (node[0] === 'string') {
            var expandedUrl = ['_'].concat(keys).join("/");
            urlMap.addExpandedUrl(expandedUrl);
            urlMap.mapExpandedUrl(expandedUrl, node[1]);
        } else {
            throw new Error("Invalid getStaticUrl syntax");
        }
    }
    traverse(cursor);

    return urlMap;
};

JavaScriptOneGetStaticUrl.UrlMap = UrlMap;

module.exports = JavaScriptOneGetStaticUrl;