var express    = require('express');
var app        = express();
var bodyParser = require('body-parser');

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
    console.log(uid);
    var all = {
      "0du4iTIWosZCGXvMmd0jmUYFoUW2":{  first_name:"Ruth",
                                        last_name:"Zamoreberg",
                                        picture:"https://scontent.xx.fbcdn.net/v/t31.0-8/17434728_117316905471300_7575482917278438652_o.jpg?oh=fc6a5cc7eac788d7e20376a9c103171c&oe=5970BABE" },

      "rKymFdHeUUfuXlhVl9E4Ad0hJ4B3":{  first_name:"Kayleigh",
                                        last_name:"Ryley",
                                        picture:"https://scontent.xx.fbcdn.net/v/t1.0-9/399820_736905483695_943839054_n.jpg?oh=020943dbfb2087e3aac4d10c005aefc4&oe=59730031" },
      "cHlhCFBLTDYo3eaLdkfXZo31Oa23":{  first_name:"Betty",
                                        last_name:"Warmansen",
                                        picture:"https://scontent.xx.fbcdn.net/v/t31.0-8/17390669_117196362150013_4389936157008162489_o.jpg?oh=e6f5db67fa54391b76f3919bdc6c7926&oe=5953F0C4" },
      "EEUpUy692aTXpRJN16TjXbZxmVT2":{  first_name:"Shireen",
                                        last_name:"Brathwaite",
                                        picture:"https://scontent.xx.fbcdn.net/v/t1.0-9/168760_732562137443_1105186_n.jpg?oh=7b3ba8f3486a2f704970647b2d28ec3f&oe=59274775" },

    };

    var matches = {};
    for (var userId in all) {

        if (all.hasOwnProperty(userId)) {
          console.log(userId);
          if (userId!=uid){

            matches[userId] = all[userId];

          }
        }
    }


    res.json(matches);
});

app.use('/', router);

app.listen(port);
console.log('Server listening to port ' + port);
