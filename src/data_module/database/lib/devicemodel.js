(function(){
  'use strict';

  /** Further Development Note
   * The following DB-Structure was chosen because of low CPU usage.
   *
   * It was also tested { device.values = [value1, value2...] },
   * but big nested array isn't performant and needs to many CPU resources
   * for all art of operations.
   *
   * Current version need < 1% CPU by writing, independent of DB size.
   * Read operations are always stressful..
   * and so it's hard to find better solution..
   **/

  // Dependencies
  var mongoose = require('mongoose'),
      Schema   = mongoose.Schema,
      _        = require('underscore'),
      async    = require('async'),
      tmpModel = require('./tmpmodel.js');

  // --- Variables --- //

  /* Global variables */
  // Important DB Collection Names (!! please remove renamed collections !!)
  var devicelistDB_name = "devices"; // list of devices
  var deviceDB_prefix = "device_"; // prefix to device id
  var tmpDB_prefix = "tmp_"; // prefix to temporary collection

  // maximal limit of values to query (by one request)
  var max_query_limit = 5000;
  // default size in Megabytes for values collections per device
  var default_storage_size = 50;
  // true if identical values need to be saved, false if not
  var save_identical_values = true;

  // tmpDB help variables
  var cur_tmp = 0; // index of current temporary collection
  // TODO write a function, that defines if there is need for more tmp collections
  var num_of_tmps = 3; // number of temporary collections
  var tmpDB = mongoose.model(tmpDB_prefix+cur_tmp, tmpModel); // temporary collection
  var tmpIsInUse = false; // true if new data is been currently written to tmpDB
  var tmp_switch_callback; // temporary callback pointer

  // Mongoose Schema to store the values
  var StorageModel = new Schema({
      _id     : Number, // index = x.getTime()
      x       : Date, // Time of Measure
      y       : Number, // Measured Value
      exceeds : Boolean // false = under the limit,
                        // true = over the limit,
                        // null = ok.
    },
    // options
    {
      // Define fixed size in bytes
      //   autoIndexId: false - shuts off the indexing by _id
      capped: { size: 1024*1024*default_storage_size },
      // Versioning (__v) is important for updates.
      // No updates => versioning is useless
      versionKey: false // gets versioning off

      //, autoIndex: false // significant performance improvement
      // TODO check if index is registered and register it manually
    }

  );
  // mongoose Schema to store the device properties
  var DeviceModel = new Schema({
      _id       : String, // index = Measuring Device ID
      roomNr    : String, // Room Number
      room      : String, // Room Type
      kind      : String, // What is measured
      method    : String, // Type of Measure
      threshold : Schema.Types.Object, // Thresholds: {'from':null,'to':null}
      isBoolean : Boolean, // true if Measure is boolean
      unit      : String, // Measuring units
      storage   : String  // Name of the Collection with Device values
    },
    // options
    { // significant performance improvement
      //autoIndex: false // http://mongoosejs.com/docs/guide.html
    }
  );


  // --- Functions --- //


  /*
   * Initializes Model with new default values from options-Object
   * Possible properties to change:
   *   max_query_limit : maximal limit of values to query (by one request)
   *   default_storage_size : default fixed size in Megabytes
   *                          for collection of values per device.
   *                          It will be used only by creation of new device
   *
   *   save_identical_values : true if identical values need to be saved
   *                           false if not
   *                           it also indicates if client needs to receive
   *                           the identical values
   *
   * e.g.: options = { max_query_limit = 10000 };
   *
   * callback passes back an error-array, if there are any problems
   *   or nothing if nothing goes wrong.
   *
   * !!WARNING!! The model is preinitilized with default values, so
   *             if there is any option wrong or empty,
   *             this option wont be changed
   *
   */
  var init = function(options, callback){
    if(options == undefined) return callback();

    var errors = [];

    if(options.max_query_limit != undefined){
      if(!_.isNumber(options.max_query_limit)){
        errors.push(new Error("max_query_limit is not a Number!"));
      } else if (options.max_query_limit <= 0) {
        errors.push(new Error("max_query_limit need to be positive!"));
      } else {
        max_query_limit = options.max_query_limit;
      }
    }

    // TODO properly change the size in Schema options!!
    if(options.default_storage_size != undefined){
      if(!_.isNumber(options.default_storage_size)){
        errors.push(new Error("default_storage_size is not a Number!"));
      } else if (options.default_storage_size <= 0) {
        errors.push(new Error("default_storage_size need to be positive!"));
      } else {
        default_storage_size = options.default_storage_size;
      }
    }

    if(options.save_identical_values != undefined){
      if(!_.isBoolean(options.save_identical_values)){
        errors.push(new Error("save_identical_values is not a Boolean!"));
      } else {
        save_identical_values = options.save_identical_values;
      }
    }

    if(errors.length < 1) return callback();
    else return callback(errors);
  }

  /*
   * Switches Temporary Database to the next one
   * and passes the current one per callback
   */
  DeviceModel.statics.switchTmpDB = function(callback){
    var last_tmpDB = tmpDB;
    // "tmpDB == last_tmpDB" is true
    cur_tmp = (cur_tmp + 1) % num_of_tmps;
    tmpDB = mongoose.model('tmp_'+cur_tmp, tmpModel);
    // "tmpDB == last_tmpDB" is false
    if(callback){
      if(tmpIsInUse) tmp_switch_callback = callback;
      else callback(last_tmpDB);
    }
  }


  // Creates or updates the device in database
  DeviceModel.statics.setDevice = function(device, callback){
    if(device === undefined){
      if(callback) return callback(new Error("device undefined!"));
      return;
    }
    this.update({'_id':device.id}, device, { upsert: true },
        function(err) {
         if (err) {
           console.warn("Device can't be written to the list!");
           console.warn(err.stack);
         }
         if(callback) callback(err);
       }
     );
  }

  // Creates or updates list of devices in database using given array "devices"
  DeviceModel.statics.setDevices = function(devices, callback){
    if(devices === undefined){
      if(callback) return callback(new Error("devices undefined!"));
      return;
    }
    if(!_.isArray(devices)){
      if(callback) return callback(new Error("devices is not an array!"));
      return;
    }
    devices.filter(function(item){return item}); //filter out empty devices
    var self = this;
    async.each(devices,
        function(device, done){
          self.update( {'_id':device.id}, device, { upsert: true },
              function(err) {
               if (err) {
                 console.warn("Device can't be written to the list!");
                 console.warn(err.stack);
               }
               done(err);
             }
          );
        },
        function(err){
          if(callback) callback(err);
        }
    )
  }

  /*
   * Append new Document to the Collection
   * newData - is a normal data-object or Array of data-objects
   * ATTENTION!!
   *    The 'id' is unique property!
   *    There cannot be two or more devices with the same id!
   *
   * If no values were appended, callback passes null as appendedData
   * Every device with non existed ID will be automatically created
   * Every unnecessary property (newData.blabla) doesn't affect this operation
   * Values never get overwritten or removed. They just getting appended.
   *
   * e.g. append({id: "1",
   *                values: [{x=<time>, y=<value>, exceeds=false},...]
   *             }, callback);
   * or append([{id: "1", values: [..]},{id: "2", values: [..]}], callback);
   */
  DeviceModel.statics.append = function (newData, callback) {
    if(newData === undefined) return;
    tmpIsInUse = true;
    var curr_tmpDB = tmpDB;

    var self = this; // allow to pass this model to global functions
    if(!_.isArray(newData)){
      return save(self, newData, function(err, appendedData){
        if(appendedData.values.length < 1) return callback(err, null);
        // fill the temporary model with data from current update
        curr_tmpDB.update({'_id':appendedData.id}, { pushAll: { 'values' : appendedData.values } }, {upsert: true },
            function(err){
              tmpIsInUse = false;
              if(tmp_switch_callback && curr_tmpDB != tmpDB){
                tmp_switch_callback(curr_tmpDB);
                tmp_switch_callback = null;
              }
              callback(err, appendedData);
            }
        );
      });
    }
// TODO: gibt es einen eindeutigen Punkt, den man im Codo erkennen kann, wenn die Daten an socket.io/client abgesendet werden???
    // append all data from array parallel,
    // and pack all returned data to one array to pass it to callback
    async.map(
      newData,
      function(data, async_callback) {
        if(data === undefined) return;

        save(self, data, function(err, result){
          if(result.values.length<1) return async_callback(err);
          // fill the temporary model with data from current update
          curr_tmpDB.update({'_id':result.id}, { 'id':result.id, $pushAll: { 'values' : result.values } }, {upsert: true },
              function(err){
                async_callback(err, result);
              }
          );
        })
      },
      function(err, appendedData){
        tmpIsInUse = false;
        if(tmp_switch_callback && curr_tmpDB != tmpDB){
          tmp_switch_callback(curr_tmpDB);
          tmp_switch_callback = null;
        }
        // remove all elements == null
// TODO: was/wofür wird gefiltert??? bzw. warum wird etwas null?
//            <-- der Kommentar ist sehr missverständlich (wirkt wie auskommentierter Code)
        appendedData = appendedData.filter(function(n){ return n });
        callback(err, (appendedData.length>0)?appendedData:null);
      }
    );
  };

  /* Global function - append()'s helper */
  // saves the data in passed collection (model)
  function save(model, newData, callback){
// TODO: Kommentar: WTF??? warum?
    if(newData.id === undefined){ // WTF?? need an id, to arrange the values
      if(callback) return callback(new Error("No id!"));
      else return;
    }
    // If no values, can check the device and save if it's new
    if(newData.values === undefined) newData.values = {};

    // open values collection or create new one
    model.findOne({'_id':newData.id},
      function(err, result){
        if(err){
          console.warn("Some DB Error by search for device!");
          console.warn(err.stack);
          return;
        }

        var storage;
        if(result && result.storage){ // the device is in the list and have .storage
          storage = mongoose.model(result.storage, StorageModel);
        } else { // write device to the list
          // create new collection of values and save it by device description
          // collection names are always lower case
          newData.storage = (deviceDB_prefix + newData.id).toLowerCase();
          model.update({'_id':newData.id},
              { $set: { 'storage': newData.storage }},
              { upsert: true },
             function(err) {
              if (err) {
                console.warn("Device can't be written to the list!");
                console.warn(err.stack);
              }
            }
          );
          storage = mongoose.model(newData.storage, StorageModel);
        }

// TODO Kommentierung: noch aktuell???
        //TODO somehow CPU efficient check for identical values in database

        if(_.isEmpty(newData.values)){
          callback(null, null);
        } else {
          // set custom _id for each value and save changed array to new variable
          var valuesToAppend = _.map(
            newData.values,
            function(item){

// TODO Die Zeit als ID???
              item._id = item.x.getTime();
              return item;
            }
          );

          // TODO stress test (lot of devices and values parallel)
          // append_new_values serves to properly writing
          //    of possible values with identical time
          // append_tries = writing tries count for problem values
          var append_new_values = function(newValue, append_tries, done){
            storage.create(newValue,
              function(err) {
                if (err) {
                  // 11000 = duplicate _id error
                  if(err.code == 11000 && append_tries < 1000){
                    // check if value is the same.
                    // if yes, we don't need to write it to db.
                    return storage.findById(newValue._id, function (err, result) {
                      if(err){ // hard to handle....
                        console.warn("Cannot find "+newValue._id);
                        console.warn(err.stack);
                        return done();
                      }


                      if(!save_identical_values && result.y === newValue.y)
                        return done();

                      // (try to increase _id's millisecond)
                      // set ( milliseconds + 1 ) % 1000
                      var old_id_time = new Date( newValue._id );
                      old_id_time.setMilliseconds(
                          ( old_id_time.getMilliseconds()+1 ) % 1000
                      );
                      newValue._id = old_id_time.getTime();
                      // try again
                      append_tries++;
                      return append_new_values(newValue, append_tries, done);

                    });
                  }
// TODO: Kommentare sollten kein Pseudo-code sein
                  // append_tries >= 1000 or error != 11000
                  // <-- Error-Code 11000 = duplicate _id error
                  return done(err);
                }
                // no errors
                delete newValue._id; // we don't need _id anymore
                return done( null, newValue );
              }
            );
          }

          // append all values parallel
          async.map(
              valuesToAppend,
              function(value, callback){
                append_new_values(value, 0, callback);
              },
              function(err, appendedValues){
                if(err){
                  if(callback) return callback(err, appendedValues);
                  else return;
                }

                callback( null,
                  { id     : newData.id,
                    values : appendedValues. // values, that were appended
                            // remove 'undefined' values
                            filter(function(item){ return item })
                  }
                );
              }
          );
        }
      }
    );
  }

  /*
   * Searches for objects to match the given request
   *  Possible request properties:
   *      query - properties to search for: {room: "..", unit: "..", id: ".."}
   *              default: null (all devices)
   *      time  - moment(...) : http://momentjs.com/docs/
   *                OR Date OR parameter to create new Date(parameter)
   *                OR {from: ..., to: ...} OR {from: ...} OR {to: ...}
   *                'from/to'-objects have the same structure
   *                as 'time' without 'from/to'
   *              e.g. '2015-08-15' or 12345 (to parse Date from)
   *                   or { from: moment('2015-08-15').add(2, 'months'),
   *                        to: moment().subtract(1, 'day') }
   *              default: null
   *      limit - maximal number of values per device to be returned,
   *              appending on time:
   *                   (-) for values before time/time.to  (e.g. last N values)
   *                   (+) for values after time/time.from (e.g. first N values)
   *                   (0) last max_query_limit/(number of devices) values
   *                       before time/time.to
   *              or without time:
   *                   (-) for last N values
   *                   (+) for first N values
   *                   (0) last max_query_limit/(number of devices) values
   *              default: null (no extra limits)
   *
   * all request properties are optional
   * and need to be in the query object (order has no influence)
   * e.g. request = { query: { id: "1" },
   *                  limit: -15,
   *                  time:  { from: moment().subtract(1, 'months') }
   *                 }
   *      it requests data for device with id = "1" from 1 month till now,
   *      limited to last 15 values per device
   *
   * you can also leave the request as null : findData(null, callback)
   * or just call findData(callback); to get data for all existing devices,
   * last max_query_limit/(number of devices) values each device
   */
  DeviceModel.statics.query = function(request, callback) {
    var self = this;
    if(!request) request = {};
    if(_.isFunction(request)){
      callback = request;
      request = {};
    }
    if(!callback) callback = function(err, results){ };

    var time; // create variable time for the DB query
    if(request.time !== undefined) {
      if(request.time.from !== undefined || request.time.to !== undefined){
        if(request.time.from){
          try {
            time = {};
            time['$gte'] = new Date(request.time.from).getTime();
          } catch (e) {
            return callback(new Error('requested time.from is wrong!'));
          }
        }
        if(request.time.to){
          try {
            if(!time) time = {};
            time['$lt'] = new Date(request.time.to).getTime();
          } catch (e) {
            return callback(new Error('requested time.to is wrong!'));
          }
        }
      } else { // no time.from and no time.to
        try {
          time = new Date(request.time).getTime();
        } catch (e) {
          return callback(new Error('requested time is wrong!'));
        }
      }
    }

    var device_query;

    if(request.query === undefined){ // if no query, search for everything
      device_query = {};
    } else {
      device_query = _.map(request.query,
          function(item){ // change id to _id for better searching
            if(item.id){ item._id=item.id; delete item.id; }
            return item;
          }
        );
    }

    self.find(device_query, function(err, devices) {
      if(err){
        return callback(err);
      }
      if(devices.length == 0) return callback(null, null);

      // get temporary max_limit
      var limit = max_query_limit/devices.length;
      if(request.limit){
        if(request.limit < -limit){
          limit = -limit;
        } else if(request.limit == 0) {
          limit = -limit;
        // } else if(request.limit > limit) {
        //   limit = limit;
        } else {
          limit = request.limit;
        }
      } else {
        limit = -limit;
      }
      limit|=limit; // parse to integer without round up

      // does a parallel search for values for every device
      //   and packs all results in one array
      async.map(
        devices,
        function(device, done){
          // query collection with values for current device
          var values_collection = mongoose.model(device.storage, StorageModel);

          var query;

          if(time !== undefined){
            query = values_collection.find({ '_id': time });
          } else {
            query = values_collection.find({});
          }

          // limit the query
          // The $natural parameter returns items according to their natural
          // order within the database. It's the fastest order to sort.
          if( limit < 0 ){
            query.sort({ $natural:-1 })
                 .limit(-limit);
          } else {
            query.sort({ $natural:1 })
                 .limit(limit);
          }
          query.select('-_id -__v'); // exclude '_id' & '__v'

          query.exec(function(err, results){
            if(err) return done(err);

            // sort ascending by date
            if( limit < 0 ) {
              results= _.sortBy(results, function(obj){ 
                return obj.x; 
              });
            }

            
            done(null, {'id':device.id, 'values': results});
          });
        },
        function(err, result) {
          if(err) return callback(err);
          // send all queried results from queried devices as one array back
          callback(null, result);
        }
      );
    });
  };

  /*
   * Change size for existing Storage-Collection
   * Arguments:
   *    id = id of device
   *    size = new size in kilobytes, that need to be set ( greater than 0 )
   *    callback = calls a function(err) at the end
   */
  DeviceModel.statics.setStorageSize = function (id, size, callback) {
    if(size <= 0) return callback(new Error("Wrong storage size"));
    this.findOne({'_id':id},
        function(err, result){
          if(err){
            console.warn("Some DB Error by search for device!");
            if(callback) return callback(err);
            return;
          }
          if(!result){ // id wasn't found
            if(callback)
              return callback(new Error("Id for resizing wasn't found!"));
            return;
          }

          mongoose.connection.db.command(
              { convertToCapped: result.storage, size: size*1024 },
              function(err){
                if(err){
                  console.warn("Cannot resize given collection!");
                  console.warn(err.stack);
                  if(callback) return callback(err);
                  return;
                }
                console.log(id+"'s storage was resized on "+size+" kb.")
              }
          );
        }
     );
  }

  module.exports = {
      init : init,
      model : mongoose.model(devicelistDB_name, DeviceModel)
  }

})();