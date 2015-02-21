'use strict';

var _ = require('lodash'),
    hashrateHelper = require('../handlebars/helpers/hashrate'),
    renderHistoricalDataGraph = require('./mixins/renderHistoricalDataGraph'),

    View = require('../View');

module.exports = View.extend({
    postRender: function () {
        var self = this,
            workers;
            
        //console.log(self.module.get('historicalData'));
        workers = _(self.module.get('historicalData'))
            .map(function (val) {
                return _(val)
                    .keys()
                    .filter(function (key) { return key.split('.')[0] === 'currentHashrate'; })
                    .map(function (key) { return key.split('.').slice(1).join('.'); })
                    .value();
            })
            .flatten()
            .unique()
            .value();
        
        if (!self.graphs) {
            self.graphs = {};
        }
                
        _.each(workers, function(worker) {
            if (!self.graphs[worker]) {
                var graph = renderHistoricalDataGraph([], '#' + worker + ' .graph', {}, {
                    yFormatter: function (value) {
                        return hashrateHelper(value);
                    }
                });
                
                graph.getSeries = function() {
                    var seriesArray = [];
                    
                    _.each(self.module.get('historicalData'), function(measurement) {
                        if (measurement['currentHashrate.' + worker] !== undefined) {
                            seriesArray.push({
                                x: (measurement.timestamp / 1000),
                                y: measurement['currentHashrate.' + worker]
                            });
                        }
                    });
                    
                    return [{
                        color: '#cae2f7',
                        name: 'Hashrate',
                        data: seriesArray
                    }];
                };
                
                graph.module = self.module;
                graph.$ = self.$;
                graph.$el = self.$el;
                self.graphs[worker] = graph;
            }
            self.graphs[worker].postRender();
        });
        
    },

    template: 'stratum'
});