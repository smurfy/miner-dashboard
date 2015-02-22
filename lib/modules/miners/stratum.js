'use strict';

var net = require('net'),
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
        interval: 2500,
        coinType: 'sha256', //or scrypt,
        hashrate: 10, //minutes
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
                    name: 'unknwon',
                    software: 'unknown',
                    shares: {},
                    submitted: 0,
                    pending: 0,
                    accepted: 0,
                    rejected: 0,
                    stale: 0,
                    rejectedPercentage: 0,
                    stalePercentage: 0,
                    difficulty: 0,
                    lastConnection: Date.now(),
                    lastShare: 0,
                    rate: 0,
                    connected: false,
                    reconnect: false,
                    uptime: 0,
                    poolReconnects: 0,
                    minerReconnects: 0,
                    lastDisconnect: 0
                },
                submits = [],
                serverBuffer = '',
                clientBuffer = '';

            client = net.connect(self.config.poolPort, self.config.poolHost);
            socket.pipe(client).pipe(socket);
            
            client.setKeepAlive(true, 600);
            socket.setKeepAlive(true, 600);

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
                        // Continue hash present, it looks like a reconnect
                        if (parsedData.params.length > 1 && parsedData.params[1]) {
                            device.reconnect = true;
                        }
                    }
                    
                    if (parsedData && parsedData.method == 'mining.authorize') {
                        device.id = self.id + '-' + parsedData.params[0].replace(/([^a-z0-9]+)/gi, '-');
                        device.name = parsedData.params[0];
                        
                        if (self.devices[device.id]) {
                            var tmpSoftware = device.software;
                            device = self.devices[device.id];
                            device.software = tmpSoftware;
                            
                            //Only allow reconnects for 60 seconds
                            if (device.lastDisconnect > 0 && ((Date.now() - device.lastDisconnect) / 1000 > 60)) {
                                device.reconnect = false;
                            }
                            
                        } else {
                            self.devices[device.id] = device;
                        }
                        
                        device.connected = true;
                        device.lastDisconnect = 0;
                        
                        // If its a reconnect we don't reset the stats
                        if (!device.reconnect) {
                            device.lastConnection = Date.now();
                            device.lastShare = 0;
                            device.shares = {};
                            device.difficulty = 1;
                        }
                    }
                    
                    if (parsedData && parsedData.method == 'mining.submit') {
                        device.lastShare = Date.now();
                        device.submitted++;
                        device.pending++;
                        if (!device.shares[device.lastShare]) {
                            device.shares[device.lastShare] = 0;
                        }
                        device.shares[device.lastShare] += device.difficulty;
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
                            
                            device.pending--;
                            
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
                device.lastDisconnect = Date.now();
            });

            socket.on('error', function (err) {
                //console.log('from miner error');
                //console.log(err);
                device.minerReconnects++;
                socket.end();
            });
            
            client.on('error', function (err) {
                //console.log('to pool rror');
                //console.log(err);
                device.poolReconnects++;
                socket.end();
            });
        });

        self.server.listen(self.config.localPort);
        
        self.interval = setInterval(function () { self.update(); }, self.config.interval);
        self.update();
    },

    update: function () {
        var self = this,
            data = {
                connected: false,
                devices: self.devices,
                pool: self.config.poolHost + ':' + self.config.poolPort
            },
            attributesToSave = _.map(self.devices, function (device) {
                return 'currentHashrate.' + device.id;
            });

        self.set = setWithHistoricalData(attributesToSave, Module.prototype.set);
            
        var multip = Math.pow(2, 48) / 65535; // sha256
        if (self.config.coinType == 'scrypt') {
            multip = Math.pow(2, 32) / (65535 * Math.pow(10, 6)); // scrypt
        }
        
        var hashrateCalcTime = Date.now() - (self.config.hashrate * 60 * 1000);
            
        _.each(self.devices, function(device) {
            var sharesCount = 0,
                shares = {},
                myHashrateCalcTime = (Date.now() - hashrateCalcTime) / 1000;
                
            _.each(device.shares, function (share, time) {
                if (time > hashrateCalcTime) {
                    shares[time] = share;
                    sharesCount += share;
                }
            });
            
            device.shares = shares;
              
            data.connected = device.connected ? true : data.connected;
            device.uptime = (Date.now() - device.lastConnection) / 1000;
            
            if (myHashrateCalcTime > device.uptime) {
                myHashrateCalcTime = device.uptime;
            }
            
            device.rate = (sharesCount / myHashrateCalcTime) * multip;
            //console.log('up:' + device.uptime + ' h: ' + myHashrateCalcTime + ' ' + multip + ' ' + sharesCount + ' ' + device.rate);
            data['currentHashrate.' + device.id] = device.rate;
        });

        self.set(data);
    },
    
    getViewData: function () {
        return this.data.connected ? this.data : {};
    }
});