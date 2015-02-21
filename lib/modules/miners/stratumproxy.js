'use strict';

var net = require('net'),
    Bluebird = require('bluebird'),
    _ = require('lodash'),

    Module = require('../../Module'),
    setWithHistoricalData = require('../../utils/setWithHistoricalData'),
    defaults = {
        connected: false
    };

module.exports = Module.extend({

    defaults: {
        poolHost: 'stratum.f2pool.com',
        poolPort: 8888,
        localPort: 8888,
        interval: 1000,
        chartTimespan: 24 * 60 * 60 * 1000,
        chartPrecision: 5 * 60 * 1000
    },

    viewId: 'stratum',

    initialize: function () {
        var self = this;
        self.title = self.config.title || self.id;
        self.devices = {};

        self.server = net.createServer(function (socket) {
            var client,
                device = {
                    id: 'unknown',
                    software: 'unknown',
                    submitted: 0,
                    accepted: 0,
                    rejected: 0,
                    stale: 0,
                    rejectedPercentage: 0,
                    stalePercentage: 0,
                    difficulty: 0,
                    started: Date.now(),
                    lastConnection: Date.now(),
                    lastshare: 0,
                    rate: 0,
                    connected: false,
                    uptime: 0
                },
                submits = [],
                serverBuffer = '',
                clientBuffer = '';

            client = net.connect(self.config.poolPort, self.config.poolHost);

            socket.pipe(client).pipe(socket);

            socket.on('data', function (buffer) {
                serverBuffer += buffer.toString();
                
                if (serverBuffer[serverBuffer.length - 1] != "\n") {
                    return;
                }
                var arrBuffer = serverBuffer.split("\n");
                for(var i=0;i<arrBuffer.length -1 ;i++) {
                    var parsedData = JSON.parse(arrBuffer[i]);
                    //console.log('>>');
                    //console.log(parsedData);
                
                    if (parsedData && parsedData.method == 'mining.subscribe') {
                        device.software = parsedData.params[0];
                    }
                    
                    if (parsedData && parsedData.method == 'mining.authorize') {
                        device.id = parsedData.params[0];
                        
                        if (self.devices[device.id]) {
                            var tmpSoftware = device.software;
                            device = self.devices[device.id];
                            device.software = tmpSoftware;
                            device.lastConnection = Date.now();
                        } else {
                            self.devices[device.id] = device;
                        }
                        
                        device.connected = true;
                    }
                    
                    if (parsedData && parsedData.method == 'mining.submit') {
                        device.submitted++;
                        device.lastshare = Date.now();
                        device.rate = Math.pow(2, 32) * (device.submitted * device.difficulty) / Math.floor((device.lastshare - device.started) / 1000);
                        submits.push(parsedData.id);
                    }
                }

                //console.log(device);
                serverBuffer = '';
            });
            
            client.on('data', function (buffer) {
                clientBuffer += buffer.toString();
                
                if (clientBuffer[clientBuffer.length - 1] != "\n") {
                    return;
                }
                
                var arrBuffer = clientBuffer.split("\n");
                for(var i=0;i<arrBuffer.length -1;i++) {
                    var parsedData = JSON.parse(arrBuffer[i]);
                    //console.log('<<');
                    //console.log(parsedData);
                    
                    if (parsedData && parsedData.id) {
                        var idx = -1;
                        if (submits.indexOf(parsedData.id) >= 0) {
                            idx = submits.indexOf(parsedData.id);
                            submits.splice(idx, 1);
                            if (parsedData.result) {
                                device.accepted++;
                            } else {
                                if (parsedData.error && parsedData.error[0] == 21) {
                                    device.stale++;
                                } else {
                                    device.rejected++;
                                }
                            }
                            
                            device.rejectedPercentage = device.rejected / (device.submitted / 100);
                            device.stalePercentage = device.stale / (device.submitted / 100);
                            
                            
                        }
                    }
                    
                    if (parsedData && parsedData.method == 'mining.set_difficulty') {
                        device.difficulty = parsedData.params[0];
                    }
                }
                
                //console.log(device);
                clientBuffer = '';
            });
            
            socket.on('close', function () {
                client.end();
                device.connected = false;
            }); 

            socket.on('error', function (err) {
                socket.end();
            });
            
            client.on('error', function (err) {
                socket.end();
            });
        });

        self.server.listen(self.config.localPort);
        
        self.interval = setInterval(function () { self.update(); }, self.config.interval);
        self.update();
    },

    update: function () {
        var data = {
                connected: false,
                devices: this.devices,
                pool: this.config.poolHost + ':' + this.config.poolPort
            };
        
        _.each(this.devices, function(device) { 
            data.connected = device.connected ? true : data.connected;
            device.uptime = (Date.now() - device.lastConnection) / 1000;
        });

        this.set(data);
    },
    
    getViewData: function () {
        return this.data.connected ? this.data : {};
    }
});