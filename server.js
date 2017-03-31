var express    = require('express');
var app        = express();
var bodyParser = require('body-parser');

var firebase = require("firebase-admin");

var serviceAccount = require("./key/wavelength-d78bb-firebase-adminsdk-9n2ei-b4e617e2d4.json");

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: "https://wavelength-d78bb.firebaseio.com"
});

var shuffle = function(arr){

  for (var i = 0; i < arr.length; i++){
       var a = arr[i];
       var b = Math.floor(Math.random() * arr.length);
       arr[i] = arr[b];
       arr[b] = a;
  }
  return arr;
}

var userMatched = function(db, currentUid, uid) {
  return new Promise(function(resolve, reject) {
      const str = `user_matches/${currentUid}/${uid}/matched`;
      var ref = db.ref(str);
      console.log("ref:",str);
      ref.once('value')
      .then(function (snap) {
       console.log("matched success:",snap.val());
       resolve(snap.val()===true);
      })
      .catch( function(error){
       console.log("matched failed:");
       reject('Failed');
      });
  });
}

var getNextProfile = function(db, res, map,currentUid, matches){

  if(Object.keys(map).length){

     const userId = Object.keys(map)[0];

     console.log("loop:",userId);

     if (userId!=currentUid){

       let obj = map[userId];

       userMatched(db, currentUid, userId).then(function(matched){

         if (!matched){
           obj.matched = false;
           matches[userId] = obj
         }

         delete  map[userId];

         getNextProfile(db, res, map,currentUid, matches);

       }).catch(function(error){
         obj.matched = false;
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

    var db = firebase.app().database();
    var ref = db.ref('user_profiles');
    ref.once('value')
     .then(function (snap) {
       console.log("start");
       getNextProfile(db, res, snap.val(),uid, {});
    }).catch(function(error){
      console.log(error);
      res.json({});
    });

});

app.use('/', router);

app.listen(port);
console.log('Server listening to port ' + port);
