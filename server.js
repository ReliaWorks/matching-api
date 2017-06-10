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

const WEIGHTS_PROXIMITY_INDEX = { WEIGHT_AREA: 0.3,
    WEIGHT_GEO_PROX: 0.1,
    WEIGHT_COMMON_AFFILIATION: 0.3,
    WEIGHT_COMMON_ACTIVITIES: 0.2,
    WEIGHT_COMMON_GENDER: 0.1 };

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

var stringToVariable = (str) => {
    if (str)
        return str.replace(/\s+/g, '_').replace(/[^0-9a-z_]/gi, '').toLowerCase();
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
    return (user1.gender && user2.gender && user1.gender == user2.gender) ? 1 : 0;
};

var getProximityIndex = (user1, user2, areaIndexValue) => {
    //proxIndex =  W1 Area + W2 LocProx +  W3 commonAffil + W4 commonAct + W5 genderCommon
    //where W1 + .. + Wn = 1
    const { WEIGHT_AREA,
        WEIGHT_GEO_PROX,
        WEIGHT_COMMON_AFFILIATION,
        WEIGHT_COMMON_ACTIVITIES,
        WEIGHT_COMMON_GENDER } = WEIGHTS_PROXIMITY_INDEX;

    const proxIndex = (areaIndexValue) +
        (WEIGHT_GEO_PROX * getGeoDistance(user1.geoLocation.coords.latitude, user1.geoLocation.coords.longitude, user2.geoLocation.coords.latitude, user2.geoLocation.coords.longitude)) +
        (WEIGHT_COMMON_AFFILIATION * numberCommonAffiliations(user1, user2)) +
        (WEIGHT_COMMON_ACTIVITIES * numberCommonActivities(user1, user2)) +
        (WEIGHT_COMMON_GENDER * sameGenderIndex(user1, user2));

    return Math.round(proxIndex);
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
                    getUser(fb, currentUser, otherUserId, areaIndexValue).then((otherUser) => {

                        const uidOther = otherUser.uid
                        results[uidOther] = otherUser;

                        delete keysLeft[otherUser.uid];

                        if (Object.keys(keysLeft).length==0)
                            resolve(results);

                    }).catch(()=>{
                        delete keysLeft[otherUserId];
                    });


                });
            }else {
                resolve(results);
            }
        }).catch(function () {
            resolve(results);
        });
    });

    return promise;
};

var getUser = (fb, currentUser, otherUserId, areaIndexValue) => {

    var promise = new Promise((resolve, reject)=>{

        fb.ref(`user_profiles/${otherUserId}`).once('value', snap => {
            const otherUser = snap.val();
            otherUser.uid = otherUserId;
            if (snap.val()) {
                fb.ref(`user_matches/${currentUser.uid}/${otherUserId}`).once('value', (snap2) => {
                    //is not in user matches already
                    if (!snap2.val()) {
                        const proximityIndex = getProximityIndex(currentUser, otherUser, areaIndexValue);
                        otherUser.proximityIndex = proximityIndex;
                        resolve(otherUser);
                    }
                });
            }
        });
    });

    return promise;

};

var getSortedArray = (results) => {

    const sortedResults = Object.keys(results).map((key)=>{
        return results[key];
    });

    sortedResults.sort(function(a, b) {
        return a.proximityIndex - b.proximityIndex;
    });

    return sortedResults;
}

var getLocationsFromUser = function (db, res, currentUser) {


    const promise = new Promise( (resolve, reject) => {

        const location = currentUser.location;

        if (!(location && location.country && location.state)) reject();

        const pathNeighborhood = `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/counties/${stringToVariable(location.county)}/cities/${stringToVariable(location.city)}/neighborhoods/${stringToVariable(location.neighborhood)}/users`;
        const pathCity = `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/counties/${stringToVariable(location.county)}/users`;
        const pathCounty = `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/counties/${stringToVariable(location.county)}/cities/${stringToVariable(location.city)}/users`;
        const pathState = `location_areas/countries/${stringToVariable(location.country)}/states/${stringToVariable(location.state)}/counties/${stringToVariable(location.county)}/cities/${stringToVariable(location.city)}/neighborhoods/${stringToVariable(location.neighborhood)}/users`;

        getLocationArea(db, currentUser, pathNeighborhood, 10000, {}).then((results) => {

            const keys = Object.keys(results);

            if (keys.length > LIMIT_RECORDS_LOCATION){

                const res = getSortedArray(results);

                resolve(res);

            }else
                getLocationArea(db, currentUser, pathCity, 40000, results).then((results) => {

                    const keys = Object.keys(results);

                    if (keys.length > LIMIT_RECORDS_LOCATION){

                        const res = getSortedArray(results);

                        resolve(res);

                    }
                    else
                        getLocationArea(db, currentUser, pathCounty, 80000, results).then((results) => {

                            const keys = Object.keys(results);

                            if (keys.length > LIMIT_RECORDS_LOCATION){

                                const res = getSortedArray(results);

                                resolve(res);

                            }else
                                getLocationArea(db, currentUser, pathState, 120000, results).then((results) => {
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

            getLocationsFromUser(db, res, snapshot.val())
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
