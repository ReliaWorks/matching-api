var express    = require('express');
var app        = express();
var bodyParser = require('body-parser');
var sha        = require('sha.js')
var firebase   = require("firebase-admin");

var serviceAccount = require("./auth/activities-test-a3871-firebase-adminsdk-971yy-829839ed20.json");

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: "https://activities-test-a3871.firebaseio.com"
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

var isValidCall= function (digest, currentUid){

  const SECRET_KEY = "dsnsdhjhj332sdnm$sms092nvy!@5";
  var sha256 = sha('sha256');
  var hash = sha256.update(SECRET_KEY+currentUid, 'utf8').digest('hex');

  console.log("hash:",hash);

}

var validateHeaderAuthorization = function(header){

  if (header){

    var arr = header.split(":");

    if (arr.length==2){
      const currentUid = arr[0];
      const digest = arr[1];

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

     if (userId!=currentUid){

       let obj = map[userId];

       userMatchedExists(db, currentUid, userId).then(function(exists){
         exists = true; //for now
         if (exists){
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
    console.log("401:", error);
    //if (error) res.send(401, error);

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
