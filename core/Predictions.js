var moment = require('moment');
var commons = require('./Commons');

//Convert array to map given an array element's key


//TODO: May have to handle unpredictable fpt values after fast passes expire
async function getFastPassPrediction(rideID, dateTime, query) {
    var firstDT = dateTime.clone().set({minute: 0, second: 0, millisecond: 0});
    var lastDT = dateTime.clone().set({hour: dateTime.hours() + 1, minute: 0, second: 0, millisecond: 0});
    var dtDiff = lastDT.getTime() - firstDT.getTime();
    var fpTimes = await query(`SELECT fastpassTime AS fpt, openHour AS openHour, hoursOpen AS hoursOpen
        FROM BatchResults 
        WHERE rideID=? AND (dateTime=? OR dateTime=?) ORDER BY dateTime`, 
        [rideID, firstDT.format("YYYY-MM-DD HH:mm:ss"), lastDT.format("YYYY-MM-DD HH:mm:ss")]);
    var predTime = null;
    if (fpTimes.length == 2) {
        var fpDiff = fpTimes[0].fpt.getTime() - fpTimes[1].fpt.getTime();
        predTime = moment(fpTimes[0].fpt.getTime() + fpDiff * (dtDiff / (60 * 60 * 1000)));
        var predHours = predTime.hours();
        if (predHours < 4) {
            predHours += 24;
        }
        if (predHours >= fpTimes[0].openHour + fpTimes[0].hoursOpen - 1) {
            if (predTime.minutes() >= 30) {
                predTime = null;
            }
        }
    } else {
        predTime = null;
    }
    //Round down to nearest 5 minutes
    if (predTime != null) {
        predTime.set({minute: (Math.round(predTime.minutes() / 5)) * 5, second: 0, millisecond: 0});
    }
    
    return predTime;
}

async function getPredictions(date, tz, query, rideID=null) {
    var args = [ date.format("YYYY-MM-DD") ]
    var rideFilter = "";
    if (rideID != null) {
        rideFilter = "AND rideID=?";
        args.push(rideID);
    }
    var results = await query(`SELECT rideID, dateTime, HOUR(dateTime) AS hour, waitMins, fastpassTime AS fastPassTime,
        openHour AS openHour, hoursOpen AS hoursOpen
        FROM BatchResults
        WHERE DATE(DATE_SUB(dateTime, INTERVAL 4 HOUR))=? ${rideFilter} ORDER BY dateTime`, args);
    for (var result of results) {
        result.dateTime = moment(result.dateTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true);
        if (result.fastPassTime != null) {
            result.fastPassTime = moment(result.fastPassTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true);
            var predHours = result.fastPassTime.hours();
            if (predHours < 4) {
                predHours += 24;
            }
            if (predHours >= result.openHour + result.hoursOpen - 1) {
                if (predHours == result.openHour + result.hoursOpen - 1) {
                    if (result.fastPassTime.minutes() >= 30) {
                        result.fastPassTime = null;
                    }
                } else {
                    result.fastPassTime = null;
                }
            }
        }
    }
    
    return commons.indexArray({}, results, 'rideID');   
}

//Get average of all prediction information for the rest of the day at a resort
async function getPredictTimeHeuristics(tz, query) {
    var now = moment().tz(tz);
    var nowStr = now.format("YYYY-MM-DD HH:mm:ss");
    var results =await query(`SELECT br.rideID AS rideID, AVG(br.waitMins) AS avgWaitMins, MIN(br.waitMins) AS minWaitMins, MAX(br.waitMins) AS maxWaitMins 
        FROM BatchResults br, ParkSchedules ps
        WHERE (br.doy=(MONTH(ps.date)*31 + DAYOFMONTH(ps.date)) AND br.year=YEAR(ps.date) 
        AND br.hour>=(HOUR(?) + DATEDIFF(DATE(?), ps.date) * 24 - br.openHour)
        AND ps.date=DATE(DATE_SUB(?, INTERVAL 4 HOUR))) GROUP BY br.rideID`, 
        [nowStr, nowStr, nowStr]);
    return commons.indexArray({}, results, "rideID");
}

//Get upcoming prediction times for the next x hours
async function getPredictTime(tz, hourOffset, query) {
    var dateTime = moment().tz(tz);
    dateTime.add(hourOffset, 'hour');
    var dtStr = dateTime.format("YYYY-MM-DD HH:mm:ss");
    var results = await query(`SELECT br.rideID AS rideID, br.waitMins AS waitMins FROM BatchResults br, ParkSchedules ps
        WHERE (br.doy=(MONTH(ps.date)*31 + DAYOFMONTH(ps.date)) AND br.year=YEAR(ps.date) 
        AND br.hour=(HOUR(?) + DATEDIFF(DATE(?), ps.date) * 24 - br.openHour)
        AND ps.date=DATE(DATE_SUB(?, INTERVAL 4 HOUR)))`, 
        [dtStr, dtStr, dtStr]);
    return commons.indexArray({}, results, "rideID");
}

//Calculates the waitRating from distance from prediction and predicted trends for wait time
function getWaitRating(waitTime, avgWaitMins, minWaitMins, maxWaitMins, firstPredictTime, secondPredictTime) {
    var waitRating = null;
    var predictTime = null;
    var getTime = new Date();
    if (waitTime != null) {
        if (firstPredictTime != null && secondPredictTime != null) {
            predictTime = ((60.0 - getTime.getMinutes())/60.0) * firstPredictTime + (getTime.getMinutes()/60.0) * secondPredictTime;
        } else if (firstPredictTime != null) {
            predictTime = firstPredictTime;
        }
        if (predictTime != null) {
            waitRating = 0;
            if (Math.abs(predictTime - waitTime) != 0) {
                waitRating = Math.pow(Math.abs(predictTime - waitTime), 1.3) * ((predictTime) - (waitTime)) / Math.abs((predictTime) - (waitTime));
            }
           
            if (maxWaitMins - minWaitMins > 5.0) {
                waitRating /= (Math.sqrt((maxWaitMins - minWaitMins)/2) * 1.5);
            } else {
                waitRating /= 5.0;
            }
            waitRating += 10;
            waitRating /= 2;
            if (waitRating > 10) {
                waitRating = 10;
            } else if (waitRating < 0) {
                waitRating = 0;
            }
        }
    }
    return waitRating;
}

module.exports = {
    getPredictions: getPredictions,
    getFastPassPrediction: getFastPassPrediction,
    getPredictTimeHeuristics: getPredictTimeHeuristics,
    getPredictTime: getPredictTime,
    getWaitRating: getWaitRating
};