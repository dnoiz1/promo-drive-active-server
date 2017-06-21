var http = require('http')
    , express = require('express')
    , swig = require('swig')
    , app = express()
    , server = http.createServer(app)
    , io = require('socket.io').listen(server)
    , mongoose = require('mongoose')
    , mysql = require('mysql')
    , JSV = require('JSV').JSV
    , jsv = JSV.createEnvironment()
    , extend = require('util')._extend
    , xml2js = require('xml2js');

var connected_clients = 0;
var padding = 43;
var lookup_query = 'SELECT typeID AS id from invtypes WHERE typeName = TRIM(?) LIMIT 1';

mongoose.connect('mongodb://nope');

var pool = mysql.createPool({
    host: '',
    user: '',
    password: '',
    database: ''
});

var eve_central_options = {
    host: 'api.eve-central.com',
    port: 80,
    path: '/api/marketstat',
    method: 'POST'
}

//extensions.useFilter(swig, 'markdown');

app.engine('html', swig.renderFile);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');
app.set('view cache', false);
swig.setDefaults({ cache: false });

app.use('/static', express.static(__dirname + '/static'));

app.get('/connected_clients', function(req, res){
    res.send((connected_clients + padding) + '');
});

app.use(function(req, res){
    res.render('index', {
        connected_clients: connected_clients + padding
    });
});

var blink_schema = mongoose.Schema({
    url: {
        type: String,
        index: { unique: true }
    },
    blink_id: Number,
    prize: {
        name: String,
        qty: Number,
        description: String,
        image_url: String,
        jita_price: Number
    },
    date: { type: Date, default: Date.now }
});

var user_schema = mongoose.Schema({
    name: {
        type: String,
        index: { unique: true }
    },
    character_id: Number,
    promo_wins: Array
})

var Blink = mongoose.model('Blink', blink_schema);
var User  = mongoose.model('user', user_schema);

var seen_data_schema = {
    "type":"object",
    "$schema": "http://json-schema.org/draft-03/schema",
    "id": "http://jsonschema.net",
    "required": true,
    "properties":{
        "blink_id": {
            "type":"string",
            "id": "http://jsonschema.net/blink_id",
            "required": true
        },
        "prize": {
            "type":"object",
            "id": "http://jsonschema.net/prize",
            "required": true,
            "properties":{
                "description": {
                    "type":"string",
                    "id": "http://jsonschema.net/prize/description",
                    "required": true
                },
                "image_url": {
                    "type":"string",
                    "id": "http://jsonschema.net/prize/image_url",
                    "required": true
                },
                "name": {
                    "type":"string",
                    "id": "http://jsonschema.net/prize/name",
                    "required": true
                },
                "qty": {
                    "type": ["string","integer","number"],
                    "id": "http://jsonschema.net/prize/qty",
                    "required": true
                }
            }
        },
        "url": {
            "type":"string",
            "id": "http://jsonschema.net/url",
            "required": true
        }
    }
}

var marketstat_schema = {
    "type":"object",
    "$schema": "http://json-schema.org/draft-03/schema",
    "id": "http://jsonschema.net",
    "required":false,
    "properties":{
        "evec_api": {
            "type":"object",
            "id": "http://jsonschema.net/evec_api",
            "required":false,
            "properties":{
                "$": {
                    "type":"object",
                    "id": "http://jsonschema.net/evec_api/$",
                    "required":false,
                    "properties":{
                        "method": {
                            "type":"string",
                            "id": "http://jsonschema.net/evec_api/$/method",
                            "required":false
                        },
                        "version": {
                            "type":"string",
                            "id": "http://jsonschema.net/evec_api/$/version",
                            "required":false
                        }
                    }
                },
                "marketstat": {
                    "type":"array",
                    "id": "http://jsonschema.net/evec_api/marketstat",
                    "required":false,
                    "items":
                        {
                            "type":"object",
                            "id": "http://jsonschema.net/evec_api/marketstat/0",
                            "required":false,
                            "properties":{
                                "type": {
                                    "type":"array",
                                    "id": "http://jsonschema.net/evec_api/marketstat/0/type",
                                    "required":false,
                                    "items":
                                        {
                                            "type":"object",
                                            "id": "http://jsonschema.net/evec_api/marketstat/0/type/0",
                                            "required":false,
                                            "properties":{
                                                "$": {
                                                    "type":"object",
                                                    "id": "http://jsonschema.net/evec_api/marketstat/0/type/0/$",
                                                    "required":false,
                                                    "properties":{
                                                        "id": {
                                                            "type":"string",
                                                            "id": "http://jsonschema.net/evec_api/marketstat/0/type/0/$/id",
                                                            "required":false
                                                        }
                                                    }
                                                },
                                                "sell": {
                                                    "type":"array",
                                                    "id": "http://jsonschema.net/evec_api/marketstat/0/type/0/sell",
                                                    "required":false,
                                                    "items":
                                                        {
                                                            "type":"object",
                                                            "id": "http://jsonschema.net/evec_api/marketstat/0/type/0/sell/0",
                                                            "required":false,
                                                            "properties":{
                                                                "min": {
                                                                    "type":"array",
                                                                    "id": "http://jsonschema.net/evec_api/marketstat/0/type/0/sell/0/min",
                                                                    "required":true,
                                                                    "items":
                                                                        {
                                                                            "type":"string",
                                                                            "id": "http://jsonschema.net/evec_api/marketstat/0/type/0/sell/0/min/0",
                                                                            "required":false
                                                                        }

                                                                }
                                                            }
                                                        }

                                                }
                                            }
                                        }

                                }
                            }
                        }

                }
            }
        }
    }
}


var lookup_item = function(item_name, callback) {
    pool.getConnection(function(err, conn){
        if (err) { return console.log(err); }
        conn.query(lookup_query, [item_name], function(err, res){
            conn.release(); 
            if (err) { return console.log(err); } 

            callback(res);
        });
    });
}

var price_check = function(item_id, callback) {
    var options = extend({}, eve_central_options);
    var post_data = "usesystem=30000142&typeid=" + item_id;
    options.headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': post_data.length
    }

    var request = http.request(options, function(response){
        var str = '';
        response.on('data', function(chunk){
            str += chunk;
        });
        response.on('end', function(){
            console.log(str);
            try {
                xml2js.parseString(str, function(err, obj){
                    console.log(JSON.stringify(obj));
                    if (err) return console.log(err);

                    var report = jsv.validate(obj, marketstat_schema);
                    if (report.errors.length === 0) {
                        callback(obj.evec_api.marketstat[0].type[0].sell[0].min[0]);
                    } else {
                        callback(0);
                    }
                });
            } catch(e) {
                console.log(e);
                callback(0);
            }
        });
    });
    request.on('error', function(e){
        console.log(e);
    });
    request.write(post_data);
    request.end();
}

var finish_seen = function(data) {
    var blink = new Blink(data)
    blink.save(function(err, b){
        if (err) {
            return console.log('saving hnng: unable to save', b);
        }
        io.sockets.emit('seen', b);
    });
}

io.sockets.on('connection', function(socket) {
    connected_clients++;

    socket.on('disconnect', function(){
        connected_clients--;
    });

    socket.on('seen', function(data) {

        console.log(data);

        var report = jsv.validate(data, seen_data_schema);
        if (report.errors.length === 0) {

            Blink.findOne({ url: data.url}, function(err, res) {
                if (err) {
                    return console.log('hnng: ', err);
                }

                if (!res) {
                    // new promo seen, lets lookup the item

                    try {

                        lookup_item(data.prize.name, function(res){
                            if (res.length === 1) {
                                console.log(res[0].id);
                                //lookup price
                                price_check(res[0].id, function(price) {
                                    data.prize.jita_price = price;
                                    finish_seen(data);
                                });
                            } else {
                                finish_seen(data);
                            }
                        });
                    } catch(e) {
                        console.log(e);
                    } //fuck
                }
            });
        } else {
            console.log('invalid',  report.errors);
        }

    });
});

server.listen(process.env.PORT || 5000, function(){
    console.log('server listening');
});
