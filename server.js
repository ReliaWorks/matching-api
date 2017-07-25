var express    = require('express');
var app        = express();
var bodyParser = require('body-parser');
var axios      = require('axios');
var jsSHA      = require("jssha");
var firebase   = require("firebase-admin");
var GeoFire    = require("geofire");

const API_SECRET_KEY      = "dsnsdhjhj332sdnm$sms092nvy!@5";
const FIREBASE_STRING_BUDDIES    = "https://activities-test-a3871.firebaseio.com";
const FIREBASE_STRING_WAVELENGTH = "https://wavelength-d78bb.firebaseio.com";
const MAP_API_KEY = 'AIzaSyACWmDGmgYDEvWuzvjpDn9GYjrafCZOSKw';
const LIMIT_RECORDS_LOCATION = 1000;
const LIMIT_DEFAULT = 50;
const NUM_AFFILIATIONS = 15;
const NUM_ACTIVITIES = 12;
const DISTANCE_RADIOUS = 2000; //km

const WEIGHTS_DISTANCE_INDEX = {
    WEIGHT_GEO_PROX: 10,
    WEIGHT_COMMON_AFFILIATION: 50,
    WEIGHT_COMMON_ACTIVITIES: 30,
    WEIGHT_COMMON_GENDER: 10 };

// INITa
var serviceAccount = require("./auth/admin/buddies.json");

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: FIREBASE_STRING_BUDDIES
});

// Helper functions

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

var shuffle = function(arr){
    for (var i = 0; i < arr.length; i++){
        var a = arr[i];
        var b = Math.floor(Math.random() * arr.length);
        arr[i] = arr[b];
        arr[b] = a;
    }
    return arr;
}

var stringToVariable = (str) => {
    if (str)
        return str.replace(/\s+/g, '_')
            .replace(/\++/g, '')
            .replace(/\-+/g, 'N')
            .replace(/[^0-9a-z_]/gi, '')
            .toLowerCase();
    return str;
};

var degreesToRadians = (degrees) => {
    return (degrees * Math.PI) / 180;
};

var getGeoDistance = (lat1, lon1, lat2, lon2) => {
    const earthRadiusKm = 6371;

    const dLat = degreesToRadians(lat2 - lat1);
    const dLon = degreesToRadians(lon2 - lon1);

    const lat1d = degreesToRadians(lat1);
    const lat2d = degreesToRadians(lat2);

    const a = (Math.sin(dLat / 2) * Math.sin(dLat / 2)) +
        (Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1d) * Math.cos(lat2d));

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
};

var numberCommonAffiliations = (user1, user2) => {
    if (!user1 || !user2 || !user1.affiliations || !user2.affiliations) return 0;

    const affiliations1 = Object.keys(user1.affiliations);
    const affiliations2 = Object.keys(user2.affiliations);
    const intersection = affiliations1.filter((n) => {
        return affiliations2.indexOf(n) !== -1;
    });

    return intersection.length;
};

var numberCommonActivities = (user1, user2) => {
    if (!user1 || !user2 || !user1.activities || !user2.activities) return 0;

    const activities1 = Object.keys(user1.activities);
    const activities2 = Object.keys(user2.activities);
    const intersection = activities1.filter((n) => {
        return activities2.indexOf(n) !== -1;
    });

    return intersection.length;
};

var sameGenderIndex = (user1, user2) => {
    //if they have the same index they are closer in the array
    return (user1.gender && user2.gender && user1.gender == user2.gender) ? 0 : 1;
};

var slice = (obj, start, limit) => {

  const keys = Object.keys(obj);

  const newObj = {};

  let counter = 0;

  let top = start + limit;

  if (top > keys.length){
    top = keys.length;
  }

  keys.forEach((key) =>{
    if (counter >= start && counter < top){
      newObj[key] = obj[key];
    };
    counter++;

  });

  return newObj;
}

var getDistanceIndex = (user1, user2) => {
    //distanceIndex =  W1 Area + W2 LocProx +  W3 commonAffil + W4 commonAct + W5 genderCommon
    //where W1 + .. + Wn = 1
    const {
        WEIGHT_GEO_PROX,
        WEIGHT_COMMON_AFFILIATION,
        WEIGHT_COMMON_ACTIVITIES,
        WEIGHT_COMMON_GENDER } = WEIGHTS_DISTANCE_INDEX;

    const distanceIndex =
        (WEIGHT_GEO_PROX *  getGeoDistance(user1.geoLocation.coords.latitude, user1.geoLocation.coords.longitude, user2.geoLocation.coords.latitude, user2.geoLocation.coords.longitude)) +
        (WEIGHT_COMMON_AFFILIATION * (NUM_AFFILIATIONS - numberCommonAffiliations(user1, user2))) +
        (WEIGHT_COMMON_ACTIVITIES * (NUM_ACTIVITIES - numberCommonActivities(user1, user2))) +
        (WEIGHT_COMMON_GENDER * sameGenderIndex(user1, user2));

    console.log('distanceIndex', distanceIndex);

    return Math.round(distanceIndex);
};


var getUser = (fb, currentUser, otherUserId) => {

    var promise = new Promise((resolve, reject)=>{

        fb.ref(`user_profiles/${otherUserId}`).once('value', snap => {

            console.log('getUser', otherUserId);

            if (snap.val()) {
                const otherUser = snap.val();
                otherUser.uid = otherUserId;

              const affiliations = Object.keys((otherUser.affiliations||[])) || [];
              const activities = Object.keys((otherUser.activities||[])) || [];


              if (otherUser.status == 'ACTIVE' && (affiliations.length || activities.length))
                    fb.ref(`user_matches/${currentUser.uid}/${otherUserId}`).once('value', (snap2) => {
                        const data = snap2.val();
                        //is not in user matches already
                        if ( (!data || (data && !data.liked))
                            && (currentUser && otherUser
                                && currentUser.geoLocation
                                && otherUser.geoLocation
                                && currentUser.geoLocation.coords
                                && otherUser.geoLocation.coords)) {

                            otherUser.distanceIndex = getDistanceIndex(currentUser, otherUser);
                            otherUser.viewed= data? data.viewed :false;
                            resolve(otherUser);
                        }else{
                            reject();
                        }
                    }).catch((e)=>{
                        console.log('error user_matches', e);
                        reject();
                    });
                else
                  reject();
            }else{
                console.log('no data user_profiles:'+otherUserId);
                reject();
            }
        }).catch(()=>{
            console.log('failed user_profiles/'+otherUserId);
            reject();
        });
    });

    return promise;

};

var randomizeViewed = (arr) => {

  const lowerBoundaryStateAndCountryUsers = 200000;
  const firstArr = [];
  const restArr = [];

  arr.forEach((item) => {
    if (item.distanceIndex < lowerBoundaryStateAndCountryUsers){
      firstArr.push(item);
    }else{
      restArr.push(item);
    }
  });

  const firstArrShuffled = shuffle(firstArr);
  const restArrShuffled = shuffle(restArr);

  return firstArrShuffled.concat(restArrShuffled);

};

var getSortedArray = (results) => {

    const sortedResults = Object.keys(results).map((key)=>{
        return results[key];
    });

    sortedResults.sort(function(a, b) {
        return a.distanceIndex - b.distanceIndex;
    });

    //not viewed goes first
    const viewedArr = [];
    const notViewedArr = [];

    sortedResults.forEach((obj)=>{
      if (obj.viewed){
        viewedArr.push(obj);
      }else{
        notViewedArr.push(obj);
      }
    });

    const restArr = randomizeViewed(viewedArr);

    const arr = notViewedArr.concat(restArr);

    return arr;
}

var setGeoFireLocations = function (db, geoFire) {

  //set locations
  db.ref(`user_profiles`).once('value', snapshot => {
    if (snapshot.val()){
      const users = snapshot.val() || {};
      const keys = Object.keys(users);

      keys.forEach((uid)=>{
        const user = users[uid];
        console.log(uid);


        if ( user.geoLocation && user.geoLocation.coords && user.geoLocation.coords.latitude && user.geoLocation.coords.longitude ){

          const location = [user.geoLocation.coords.latitude, user.geoLocation.coords.longitude];
          geoFire.set(uid, location).then(function() {
            console.log(uid + " initially set to [" + location + "]");
            //console.log('sss');
          }).catch(function(e){console.log('err',e)});
        }
      });

    }
  });
}

var getUserList = (db, uid, listArr) => {

  const promise = new Promise((resolve, reject)=>{

    if (listArr.length==0) {
      resolve([]);
      return;
    }

    const result = new Array(listArr.length);
    let left = listArr.length;

    for(let index = 0; index < listArr.length; index++){
      const otherUid = listArr[index];

      db.ref(`user_profiles/${otherUid}`).once('value', snapshot => {
        const currentIndex = index;

        if (snapshot.val()){
          result[currentIndex] = snapshot.val();
          result[currentIndex].uid = otherUid;
          left--;
          if (left==0)
            resolve(result);
        }
      });
    }

  });

  return promise;
}


var getUsers = (fb, currentUser, userRef) => {

  const promise = new Promise((resolve, reject)=>{
    const uids = Object.keys(userRef);
    let keysLeft = userRef;
    const results = {};

    if (uids.length == 0)
      resolve([]);

    uids.forEach((otherUserId) => {
      //get other user
      const currentUserId = currentUser.uid;

      if (currentUserId==otherUserId){

        delete keysLeft[otherUserId];

        if (Object.keys(keysLeft).length==0){
          resolve(results);
        }
      }else{
        getUser(fb, currentUser, otherUserId).then((otherUser) => {

          //console.log('User:',otherUser.uid, otherUser.distanceIndex);
          const uidOther = otherUser.uid

          if (!results[uidOther])
            results[uidOther] = otherUser;

          delete keysLeft[otherUser.uid];

          if (Object.keys(keysLeft).length==0){
            resolve(results);
          }

        }).catch((e)=>{
          delete keysLeft[otherUserId];
          if (Object.keys(keysLeft).length==0)
            resolve(results);
        });
      }

    });

  });

  return promise;
}

var getCurrentUser = (db, uid) => {
  const promise = new Promise((resolve,reject)=>{
    db.ref(`user_profiles/${uid}`).once('value', snapshot => {

      const currentUser = snapshot.val() || {};

      currentUser.uid = uid;
      resolve(currentUser);

    },
    (err)=>{
      reject();
    });
  });

  return promise;
}

var putResultsFb = (db, uid, references) =>{
  const uids = Object.keys(references);

  const ref = db.ref(`match_results/${uid}`);
  const list = [];

  let k = 0;
  uids.forEach((key)=>{
    const obj = references[key];

    list[k++]=obj.uid;
  });

  ref.set(list);
};

var getClosestUserReferences = (db, currentUser, radious) => {

  const promise = new Promise((resolve, reject) => {

    if (currentUser && currentUser.geoLocation && currentUser.geoLocation.coords && currentUser.geoLocation.coords.latitude && currentUser.geoLocation.coords.longitude){

      const users = {};

      const loc = [currentUser.geoLocation.coords.latitude, currentUser.geoLocation.coords.longitude];

      var firebaseRef = firebase.database().ref('geoLocations');

      var geoFire = new GeoFire(firebaseRef);

      const newQueryCriteria = {
        center: loc,
        radius: radious
      };

      const geoQuery = geoFire.query(newQueryCriteria);

      var listener = geoQuery.on("key_entered", function(key, location, distance) {
        console.log(key + " entered query at " + location + " (" + distance + " km from center)");
        users[key] = distance;
      });

      geoQuery.on('ready', function () {
        listener.cancel();
        geoQuery.cancel();
        resolve(users);
      });

      geoFire.set(currentUser.uid,loc);

    }else{
      reject();
    }
  });

  return promise;
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


router.get('/match_geo/:uid', function(req, res) {

  var uid = req.params.uid;

  var offset = parseInt(req.query.offset) || 0;
  var limit = parseInt(req.query.limit) || LIMIT_DEFAULT;

  if (limit < 1){
    console.log("401:", "Limit must be greater than 1.");
    return;
  }

  if (offset < 0){
    console.log("401:", "Offset must be greater than 0.");
    return;
  }


  console.log('uid:',uid);

  var header=req.headers['authorization'];
  console.log("header:",header);

  const error = validateHeaderAuthorization(header);

  if (error) {
    console.log("401:", error);
    //res.send(401, error);
    //return;
  };

  var db = firebase.app().database();

  getCurrentUser(db, uid)
    .then((currentUser)=>{

      if (offset == 0){
        
        let radious = DISTANCE_RADIOUS;
        if (currentUser.distanceRadious && Number.isInteger(currentUser.distanceRadious)){
          radious = currentUser.distanceRadious;
        }

        getClosestUserReferences(db, currentUser, radious)
          .then((list)=>{
            const pageRef = slice(list, 0, LIMIT_RECORDS_LOCATION)
            //get user profiles from references
            getUsers(db, currentUser, pageRef)
              .then((results)=>{
                const sortedResults = getSortedArray(results);

                putResultsFb(db, currentUser.uid, sortedResults);

                const page = sortedResults.slice(0, limit);

                res.json(page);
                return;

              })
              .catch(()=>{
                res.json([]);
                return;
              });

          })
          .catch(()=>{
            res.send(501, "Problem retrieving user references");
            return;
          });
      }else{
        //get user profiles from results
        const ref = db.ref(`match_results/${currentUser.uid}`);

        ref.once('value',(snap)=>{
          if (snap.val()){

            getUserList(db, currentUser.uid, snap.val())
              .then((results)=>{

                const top = (offset + limit) > results.length ? results.length : offset + limit;

                const page = results.slice(offset, top);

                res.json(page);
                return;

              })
              .catch(()=>{
                res.json([]);
                return;
              });

          }
          else{
            res.json([]);
            return;
          }
        },(err)=>{
          console.log(err);
        })
      }

    })
    .catch(()=>{
      res.send(501, "User not found");
      return;
    });

  //setGeoFireLocations(db,geoFire);

});


app.use('/', router);

app.listen(port);
console.log('Server listening to port ' + port);
