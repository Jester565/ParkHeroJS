var rp = require('request-promise-native');
var moment = require('moment-timezone');
var cheerio = require('cheerio');
var disCommons = require('./DisCommons');

async function getRideInfos(maxImgSize) {
    var options = {
        method: 'GET',
        url: 'https://disneyland.disney.go.com/attractions/',
        headers: {
            'x-requested-with': ' XMLHttpRequest'
        }
    };
    var body = await rp(options);
    var $ = cheerio.load(body, {
        normalizeWhitespace: true,
        xmlMode: true
    });

    var rideInfos = [];
    $('li[data-entityID]').each((i, ref) => {
        var elm = $(ref);
        var entityID = elm.attr('data-entityID');
        var semiIdx = entityID.indexOf(';');
        if (semiIdx < 0) {
            return;
        }
        var rideID = entityID.substr(0, semiIdx);
        var entityType = entityID.substr(semiIdx + 1);
        if (entityType != 'entityType=Attraction') {
            return;
        }


        var rideInfo = {};
        rideInfo.id = parseInt(rideID);
        rideInfo.name = elm.find('.cardName').text();

        var urlElm = elm.find("a[href]");
        var rideUrl = urlElm.attr('href');
        var parkUrlNameI = rideUrl.indexOf('/attractions/') + '/attractions/'.length;
        var parkUrlName = rideUrl.substr(parkUrlNameI);
        rideInfo.parkUrlName = parkUrlName.substr(0, parkUrlName.indexOf('/'));

        //Get image url for maxImageSize
        var imgElm = elm.find('source').first();
        var imgUrl = imgElm.attr('src');
        imgUrl = disCommons.resizeDisUrl(imgUrl, maxImgSize);
        rideInfo.imgUrl = imgUrl;
        
        var i = 0;
        elm.find('.line1').each((idx, lineRef) => {
            var lineElm = $(lineRef);
            if (i == 0) {
                var height = lineElm.text();
                rideInfo.height = height.substr(height.indexOf(":") + 1).trim();
            } else if (i == 1) {
                rideInfo.labels = lineElm.text();
            } else if (i == 2) {
                rideInfo.location = lineElm.text();
            }
            i++;
        });
        
        rideInfos.push(rideInfo);
    });
    return rideInfos;
}

async function getRideTimesForPark(token, parkID) {
    var options = {
        method: 'GET',
        uri: "https://api.wdpro.disney.go.com/facility-service/theme-parks/" + parkID.toString() + "/wait-times",
        qs: {"region": "us"},
        headers: {
            "Authorization": "BEARER " + token,
            "Accept": "application/json;apiversion=1",
            "X-Conversation-Id": "WDPRO-MOBILE.MDX.CLIENT-PROD",
            "X-App-Id": "WDW-MDX-ANDROID-3.4.1",
            "X-Correlation-ID": Date.now()
        },
        json: true
    };
    var body = await rp(options);
    
    var rideTimes = [];
    var entries = body['entries'];
    
    for (var entry of entries) {
        if (entry.type == "Attraction") {
            var rideTime = {
                status: null,
                fastPassTime: null,
                waitMins: null
            };
            rideTime["id"] = parseInt(entry.id);
            rideTime["name"] = entry.name;
            if (entry.waitTime != null) {
                if (entry.waitTime.postedWaitMinutes != null) {
                    rideTime["waitMins"] = entry.waitTime.postedWaitMinutes;
                }
                var fpObj = entry.waitTime.fastPass;
                if (fpObj != null && fpObj.available && fpObj.startTime != null && fpObj.startTime[2] == ':') {
                    rideTime["fastPassTime"] = moment(fpObj["startTime"], 'HH:mm:ss');
                }
                rideTime["status"] = entry.waitTime["status"];
            }
            rideTimes.push(rideTime);
        }
    }
    return rideTimes;
}

//Get all the latest ride times from Disney API
async function getRideTimes(token, parkIDs) {
    var promises = [];
    for (var parkID of parkIDs) {
        promises.push(getRideTimesForPark(token, parkID));
    }
    var parkRideTimes = await Promise.all(promises);
    var rideTimes = parkRideTimes[0];
    for (var i = 1; i < parkRideTimes.length; i++) {
        rideTimes.push.apply(rideTimes, parkRideTimes[i]);
    }
    return rideTimes;
}

module.exports = {
    getRideTimes: getRideTimes,
    getRideInfos: getRideInfos
}