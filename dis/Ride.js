var rp = require('request-promise-native');
var moment = require('moment-timezone');
var cheerio = require('cheerio');
var resortManager = require('../core/ResortManager');

var util = require('util');
var sleep = util.promisify((a, f) => setTimeout(f, a));

function getPosition(string, subString, index) {
    return string.split(subString, index).join(subString).length;
 }

//Parses HTML to get rides and puts in database
async function getRideInfo(rideUrl, maxImgSize) {
    //extract ride name from the url
    //var rideNameUrlStartIdx = getPosition(rideUrl, '/', 3) + 1;
    //var rideNameUrlEndIdx = getPosition(rideUrl, '/', 4);
    //var rideNameUrl = rideUrl.substring(rideNameUrlStartIdx, rideNameUrlEndIdx);
    //var totalUrl = DIS_URL + rideUrl;
    var options = {
        method: 'GET',
        uri: rideUrl
    };

    var body = await rp(options);
    
    const $ = cheerio.load(body);
    
    //Frontierland
    var land = $(".locationLandArea").text().trim();
    
    //40
    var requiredHeight = null;
    var requiredHeightStr = $(".restriction").text();
    var inchMarkIdx = requiredHeightStr.indexOf('"');
    if (inchMarkIdx > 0) {
        requiredHeight = parseInt(requiredHeightStr.substring(0, inchMarkIdx));
    }
    
    //Teens, Children
    var ageStr = $(".ageInfoText").text();
    var ageArr = ageStr.split(",");
    for (var i = 0; i < ageArr.length; i++) {
        ageArr[i] = ageArr[i].trim();
    }
    
    //Small drops, Big drops
    var thrillArr = null;
    var thrillStr=  $(".thrillFactorText").text();
    if (thrillStr != null) {
        thrillArr = thrillStr.split(',');
        for (var i = 0; i < thrillArr.length; i++) {
            thrillArr[i] = thrillArr[i].trim();
        }
    }
    
    var imgUrls = [];
    $("img").each(function(idx) {
        var src = $(this).attr('src');
        if (src.indexOf(rideNameUrl) > 0) {
            var resizeIdx = src.indexOf('resize');
            var resizeStr = src.substring(resizeIdx);
            var widthStartIdx = getPosition(resizeStr, '/', 3) + resizeIdx;
            var widthEndIdx = getPosition(resizeStr, '/', 4) + resizeIdx;
            src = src.substring(0, widthStartIdx) + '/' + maxImgSize.toString() + src.substring(widthEndIdx);
            imgUrls.push(src);
        }
    });
    
    return {
        land: land,
        requiredHeight: requiredHeight,
        ages: ageArr,
        thrills: thrillArr,
        imgUrls: imgUrls
    }
}

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

        //Get image url for maxImageSize
        var imgElm = elm.find('source').first();
        var imgUrl = imgElm.attr('src');
        var resizeIdx = imgUrl.indexOf('resize');
        var resizeStr = imgUrl.substring(resizeIdx);
        var widthStartIdx = getPosition(resizeStr, '/', 3) + resizeIdx;
        var widthEndIdx = getPosition(resizeStr, '/', 4) + resizeIdx;
        imgUrl = imgUrl.substring(0, widthStartIdx) + '/' + maxImgSize.toString() + imgUrl.substring(widthEndIdx);
        rideInfo.imgUrl = imgUrl;

        var i = 0;
        elm.find('.line1').each((idx, lineRef) => {
            var lineElm = $(lineRef);
            if (i == 0) {
                var height = lineElm.text();
                rideInfo.height = height.substr(height.indexOf(":") + 1);
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

//Get all the latest ride times from Disney API
async function getRideTimes(token, parkID, tz) {
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
                    rideTime["fastPassTime"] = moment(fpObj["startTime"], 'HH:mm:ss').tz(tz);
                }
                rideTime["status"] = entry.waitTime["status"];
            }
            rideTimes.push(rideTime);
        }
    }
    return rideTimes;
}

module.exports = {
    getRideTimes: getRideTimes,
    getRideInfos: getRideInfos
}