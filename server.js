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
const LIMIT_RECORDS_LOCATION = 1000;
const NUM_AFFILIATIONS = 15;
const NUM_ACTIVITIES = 12;

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

var getDistanceIndex = (user1, user2, areaIndexValue) => {
    //distanceIndex =  W1 Area + W2 LocProx +  W3 commonAffil + W4 commonAct + W5 genderCommon
    //where W1 + .. + Wn = 1
    const {
        WEIGHT_GEO_PROX,
        WEIGHT_COMMON_AFFILIATION,
        WEIGHT_COMMON_ACTIVITIES,
        WEIGHT_COMMON_GENDER } = WEIGHTS_DISTANCE_INDEX;

    const distanceIndex = (areaIndexValue) +
        (WEIGHT_GEO_PROX *  getGeoDistance(user1.geoLocation.coords.latitude, user1.geoLocation.coords.longitude, user2.geoLocation.coords.latitude, user2.geoLocation.coords.longitude)) +
        (WEIGHT_COMMON_AFFILIATION * (NUM_AFFILIATIONS - numberCommonAffiliations(user1, user2))) +
        (WEIGHT_COMMON_ACTIVITIES * (NUM_ACTIVITIES - numberCommonActivities(user1, user2))) +
        (WEIGHT_COMMON_GENDER * sameGenderIndex(user1, user2));

    console.log('distanceIndex', distanceIndex);

    return Math.round(distanceIndex);
};


var getLocationArea = (fb, currentUser, path, areaIndexValue, results) => {

    const promise = new Promise((resolve, reject) => {
        const ref = fb.ref(path).orderByKey();

        ref.limitToFirst(LIMIT_RECORDS_LOCATION);

        ref.once('value', snapshot => {
            const data = snapshot.val();
            if (data) {
                const keys = Object.keys(data).slice(0);
                let keysLeft = data;

                if (keys.length == 0)
                    resolve(results);

                keys.forEach((otherUserId) => {
                    //get other user
                    const currentUserId = currentUser.uid;

                    if (currentUserId==otherUserId){

                        delete keysLeft[otherUserId];

                        if (Object.keys(keysLeft).length==0)
                            resolve(results);

                    }else{
                        getUser(fb, currentUser, otherUserId, areaIndexValue).then((otherUser) => {


                            console.log('User:',otherUser.uid, otherUser.distanceIndex);
                            const uidOther = otherUser.uid

                            if (!results[uidOther])
                                results[uidOther] = otherUser;

                            delete keysLeft[otherUser.uid];

                            if (Object.keys(keysLeft).length==0)
                                resolve(results);

                        }).catch((e)=>{
                            delete keysLeft[otherUserId];
                            if (Object.keys(keysLeft).length==0)
                                resolve(results);
                        });
                    }

                });
            }else {
                resolve(results);
                console.log('node data');
            }
        }).catch(function (e) {
            resolve(results);
            console.log('a2',e);
        });
    });

    return promise;
};

var getUser = (fb, currentUser, otherUserId, areaIndexValue) => {

    var promise = new Promise((resolve, reject)=>{

        fb.ref(`user_profiles/${otherUserId}`).once('value', snap => {

            console.log('getUser', otherUserId);

            if (snap.val()) {
                const otherUser = snap.val();
                otherUser.uid = otherUserId;

                fb.ref(`user_matches/${currentUser.uid}/${otherUserId}`).once('value', (snap2) => {
                    const data = snap2.val();
                    //is not in user matches already
                    if ( (!data || (data && !data.liked))
                        && (currentUser && otherUser
                            && currentUser.geoLocation
                            && otherUser.geoLocation
                            && currentUser.geoLocation.coords
                            && otherUser.geoLocation.coords)) {

                        const distanceIndex = getDistanceIndex(currentUser, otherUser, areaIndexValue);
                        otherUser.distanceIndex = distanceIndex;
                        otherUser.viewed= data? data.viewed :false;
                        resolve(otherUser);
                    }else{
                        reject();
                    }
                }).catch((e)=>{
                    console.log('error user_matches', e);
                    reject();
                });
            }else{
                console.log('no data user_profiles:'+otherUserId);
                reject();
            }
        }).catch(()=>{
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

var getLocationsFromUser = function (db, res, currentUser) {


    const promise = new Promise( (resolve, reject) => {

        const location = currentUser.location;

        if (!(location && location.country && location.state)) reject();

        const pathNeighborhood = `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/counties/${stringToVariable(location.county)}/cities/${stringToVariable(location.city)}/neighborhoods/${stringToVariable(location.neighborhood)}/users`;
        const pathCity= `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/counties/${stringToVariable(location.county)}/cities/${stringToVariable(location.city)}/users`;
        const pathCounty = `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/counties/${stringToVariable(location.county)}/users`;
        const pathState = `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/users`;
        const pathCountry = `location_areas/countries/${stringToVariable(location.country)}/users`;

        getLocationArea(db, currentUser, pathCity, 10, {}).then((results) => {
            console.log(pathNeighborhood);
            const keys = Object.keys(results);

            if (keys.length > LIMIT_RECORDS_LOCATION){

                const res = getSortedArray(results);

                resolve(res);

            }else
                getLocationArea(db, currentUser, pathCounty, 10000, results).then((results) => {

                    const keys = Object.keys(results);

                    if (keys.length > LIMIT_RECORDS_LOCATION){

                        const res = getSortedArray(results);

                        resolve(res);

                    }
                    else
                        getLocationArea(db, currentUser, pathState, 100000, results).then((results) => {

                            const keys = Object.keys(results);

                            if (keys.length > LIMIT_RECORDS_LOCATION){

                                const res = getSortedArray(results);
                                resolve(res);

                            }else
                                getLocationArea(db, currentUser, pathCountry, 200000, results).then((results) => {
                                  const res = getSortedArray(results);
                                  resolve(res);
                                });
                        });
                });
        });
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

    //get user location

    db.ref(`user_profiles/${uid}`).once('value', snapshot => {
        if (snapshot.val()){
            const currentUser = snapshot.val();
            currentUser.uid = uid;

            getLocationsFromUser(db, res, currentUser)
                .then(function(results){
                    res.json(results);
                    return;
                })
                .catch(function (e) {
                    res.json([]);
                    return;
                })

        }else{
            res.send(501, "User not found");
            return;
        }
    });
});


app.use('/', router);

app.listen(port);
console.log('Server listening to port ' + port);
