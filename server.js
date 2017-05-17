var express    = require('express');
var app        = express();
var bodyParser = require('body-parser');
var axios      = require('axios');
var jsSHA      = require("jssha");
var firebase   = require("firebase-admin");
const API_SECRET_KEY      = "dsnsdhjhj332sdnm$sms092nvy!@5";
const FIREBASE_STRING_BUDDIES    = "https://activities-test-a3871.firebaseio.com";
const FIREBASE_STRING_WAVELENGTH = "https://activities-test-a3871.firebaseio.com";
const MAP_API_KEY = 'AIzaSyACWmDGmgYDEvWuzvjpDn9GYjrafCZOSKw';

// INITa
var serviceAccount = require("./auth/admin/buddies.json");

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: FIREBASE_STRING_BUDDIES
});

// Helper functions
var shuffle = function(arr){
  for (var i = 0; i < arr.length; i++){
       var a = arr[i];
       var b = Math.floor(Math.random() * arr.length);
       arr[i] = arr[b];
       arr[b] = a;
  }
  return arr;
}

var isValidCall= function (digest, currentUid){

  const shaObj = new jsSHA("SHA-256", "TEXT");
  shaObj.update(API_SECRET_KEY + currentUid);
  const hash = shaObj.getHash("HEX");

  console.log("hash:",hash);

  return digest == hash;

}

var validateHeaderAuthorization = function(header){

  if (header){
    var arr = header.split(":");

    if (arr.length==2){
      const digest = arr[0];
      const currentUid = arr[1];

      if (isValidCall(digest, currentUid)){
        return '';
      }else{

        return 'Invalid credentials';
      }

    }else{
      return 'Invalid credentials';
    }

  }else{
    return 'Not authorized!';
  }
}

var userMatchedExists = function(db, currentUid, uid) {
  return new Promise(function(resolve, reject) {
      const str = `user_matches/${currentUid}/${uid}`;
      var ref = db.ref(str);
      console.log("ref:",str);
      ref.once('value')
      .then(function (snap) {
       console.log("branch found:",snap.val());
       resolve(snap.val()!==null);
      })
      .catch( function(error){
       console.log("branch failed:");
       reject('Failed');
      });
  });
}

var getNextProfile = function(db, res, map,currentUid, matches){

  if(Object.keys(map).length){

     const userId = Object.keys(map)[0];

     console.log("loop:",userId);

     let obj = map[userId];

     if (userId!=currentUid && obj.first_name){

       userMatchedExists(db, currentUid, userId).then(function(exists){

         if (!exists){
           console.log("Added");
           matches[userId] = obj
         }

         delete  map[userId];

         getNextProfile(db, res, map,currentUid, matches);

       }).catch(function(error){

         console.log("Added e");
         matches[userId] = obj

         delete  map[userId];

         getNextProfile(db, res, map,currentUid, matches);
       });

     }else{
       console.log("Diff");
       delete  map[userId];
       getNextProfile(db, res, map,currentUid, matches);
     }

  }else{

    const keys = shuffle(Object.keys(matches));

     let shuffled = {};

     for (var key in keys){
        shuffled[keys[key]] = matches[keys[key]];
     }

     res.json(shuffled);

  }

}

var getLocationFromGoogleMapAPI = function(res, db, locationHash, latitude, longitude){

  axios.get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${MAP_API_KEY}`)
    .then(function (response) {

      if ( response.data
            && response.data.results
            && response.data.results.length
            && response.data.results[0].address_components
            && response.data.results[0].address_components.length
          )
      {
          var addressComponents = response.data.results[0].address_components;

          var location = {
            city:  '',
            state: '',
            country: ''
          };

          for (var i = 0; i < addressComponents.length; i++) {
              var component = addressComponents[i];
              console.log(component);
              switch(component.types[0]) {
                  case 'locality':
                      location.city = component.long_name;
                      break;
                  case 'political':
                      if (!location.city)
                        location.city = component.long_name;
                      break;
                  case 'administrative_area_level_1':
                      location.state = component.short_name;
                      break;
                  case 'country':
                      location.country = component.long_name;
                      break;
              }
          };

          db.ref(`location_cache/${locationHash}`).set(location);
          res.json(location);


      }else {
        console.log('Data',response.data);
        res.send(501, "Couldn't retrieve location");
        return;
      }

    })
    .catch(function (error) {
      console.log(error);
      res.send(501, error);
      return;
    });

}


// Server Handlers
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = process.env.PORT || 8080;
var router = express.Router();

router.use(function(req, res, next) {
    console.log('Init');
    next();
});

router.get('/match/:uid', function(req, res) {

    var uid = req.params.uid;
    console.log('uid:',uid);

    var header=req.headers['authorization'];
    console.log("header:",header);

    const error = validateHeaderAuthorization(header);

    if (error) {
      console.log("401:", error);
      res.send(401, error);
      return;
    };

    var db = firebase.app().database();
    var ref = db.ref('user_profiles');
    ref.once('value')
     .then(function (snap) {
       console.log("start", snap.val());
       getNextProfile(db, res, snap.val(),uid, {});
    }).catch(function(error){
      console.log(error);
      res.json({});
    });

});

router.get('/location/:latLong', function(req, res) {

    var db = firebase.app().database();

    var header=req.headers['authorization'];
    console.log("header:",header);

    const error = validateHeaderAuthorization(header);

    if (error) {
      console.log("401:", error);
      res.send(401, error);
      return;
    };

    var latLongStr = req.params.latLong;
    console.log('latLongStr:',latLongStr);
    var arr = latLongStr.split(':');

    if (arr.length!=2){
      res.send(501, "Invalid parameter");
      return;
    }

    var latitude = arr[0];
    var longitude = arr[1];
    const shaObj = new jsSHA("SHA-256", "TEXT");
    shaObj.update(latitude + longitude);
    const locationHash = shaObj.getHash("HEX");

    db.ref(`location_cache/${locationHash}`)
      .once('value', snapshot => {

        const cacheExists = snapshot.val() !== null

        if (cacheExists){
          console.log('Found in cache');
          res.json(snapshot.val());
        }else{
          console.log('Not in the cache', latLongStr);
          getLocationFromGoogleMapAPI(res, db, locationHash, latitude, longitude);
        }

    });

});

app.use('/', router);

app.listen(port);
console.log('Server listening to port ' + port);
