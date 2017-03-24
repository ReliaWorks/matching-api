var express    = require('express');
var app        = express();
var bodyParser = require('body-parser');
var firebase = require('firebase');
var config = {
    apiKey: "AIzaSyC5B1L0NfK0WsZYRtVjVUleo6To9aFuDf8",
    authDomain: "activities-test-a3871.firebaseapp.com",
    databaseURL: "https://activities-test-a3871.firebaseio.com",
    storageBucket: "activities-test-a3871.appspot.com",
    messagingSenderId: "432468217036"
  };
firebase.initializeApp(config);

var shuffle = function(arr){

  for (var i = 0; i < arr.length; i++){
       var a = arr[i];
       var b = Math.floor(Math.random() * arr.length);
       arr[i] = arr[b];
       arr[b] = a;
  }
  return arr;
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

    var ref = firebase.app().database().ref('user_profiles');
    ref.once('value')
     .then(function (snap) {

     var matches = {};
     var all = snap.val();
     for (var userId in all) {

         if (all.hasOwnProperty(userId)) {

           if (userId!=uid){

             matches[userId] = all[userId];

           }
         }
     }

     //shuffle
     const keys = shuffle(Object.keys(matches));

     let shuffled = {};

     for (var key in keys){
        shuffled[keys[key]] = matches[keys[key]];
     }

     res.json(shuffled);

    });

});

app.use('/', router);

app.listen(port);
console.log('Server listening to port ' + port);
