var rides = require('../dis/Ride');
var request = require('request');
var imgUploader = require('./ImageUploader');
var resortManager = require('./ResortManager');
var moment = require('moment-timezone');
var predictionManager =require('./Predictions');
var uuidv4 = require('uuid/v4');
var commons = require('./Commons');

async function getRideHistory(date, tz, query, rideID=null) {
    var args = [ date.format("YYYY-MM-DD") ]
    var rideFilter = "";
    if (rideID != null) {
        rideFilter = "AND rideID=?";
        args.push(rideID);
    }
    var results = await query(`SELECT rideID, dateTime, HOUR(dateTime) AS hour, minute(dateTime) AS minute, waitMins, fastPassTime, status
        FROM RideTimes WHERE DATE(DATE_SUB(dateTime, INTERVAL 4 HOUR))=? ${rideFilter} ORDER BY dateTime`, args);
    var reachedLastHourOfDate = false;
    var dateStr = date.format("YYYY-MM-DD");
    for (var result of results) {
        if (result.fastPassTime != null) {
            result.fastPassTime = moment(dateStr + " " + result.fastPassTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true);
            if (result.fastPassTime.hours() < 4) {
                result.fastPassTime.add(1, 'days');
            }
        }
        if (result.hour == 23) {
            reachedLastHourOfDate = true;
        }
        if (result.hour < 4 && reachedLastHourOfDate) {
            result.hour += 24;
        }
        result.dateTime = moment(result.dateTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true);
    }
    return commons.indexArray({}, results, 'rideID');
}

function assignDate(date, time) {
    var dateClone = date.clone();
    if (time.hours() < 4) {
        dateClone.add(1, 'days');
    }
    return moment(dateClone.format("YYYY-MM-DD") + " " + time.format("HH:mm:ss"), "YYYY-MM-DD HH:mm:ss");
}

function diffDateTimes(dt1, dt2) {
    if (dt1 != null && dt2 != null) {
        return dt1.valueOf() - dt2.valueOf();
    }
    return null;
}

async function getRideDPs(date, now, tz, query, rideID = null) {
    var queryPromises = [
        predictionManager.getPredictions(date, tz, query, rideID),
        getRideHistory(date, tz, query, rideID),
        getSavedRides(query, true)
    ];
    var queryResults = await Promise.all(queryPromises);
    var allRidePredictions = queryResults[0];
    var allRideHistory = queryResults[1];
    var rides = queryResults[2];

    var isToday = now.clone().subtract(4, 'hours').format("YYYY-MM-DD") == date.format("YYYY-MM-DD");

    var allRideDPs = [];
    
    for (var ride of rides) {
        var rideID = ride.id;
        var ridePredictions = allRidePredictions[rideID];
        var rideHistory = allRideHistory[rideID];
        if (ridePredictions == null) {
            continue;
        }
        console.log("RUNNING RIDEID: ", rideID);

        var firstDateTime = (ridePredictions.length > 0)? ridePredictions[0].dateTime: null;
        var maxFastPassAvailableDiff = diffDateTimes(now, firstDateTime);

        if (isToday && ride.fastPassTime != null) {
            allRideHistory[rideID].push({
                fastPassTime: moment(now.format("YYYY-MM-DD") + " " + ride.fastPassTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true),
                dateTime: now.clone()
            });
        }
        var prevHistoryPoint = null;
        var prevFastPassPrediction = null;
        var prevPredictFpDiff = null;

        var historicalAdjustFactor = 1;

        var historyI = 0;

        var dps = [];
        ridePredictions.forEach((prediction, i) => {
            if (historyI < rideHistory.length) {
                var nextPrediction = (i + 1 < ridePredictions.length)? ridePredictions[i + 1]: null;

                var historyPointsInHour = [];
                while (historyI < rideHistory.length) {
                    var historyPoint = rideHistory[historyI];
                    if (historyPoint.hour > prediction.hour) {
                        break;
                    } else if (historyPoint.hour == prediction.hour) {
                        historyPointsInHour.push(historyPoint);
                    }
                    historyI++;
                }
                
                var predictFastPassDiff = (nextPrediction != null)? diffDateTimes(nextPrediction.fastPassTime, prediction.fastPassTime): null;
                if (predictFastPassDiff == null) {
                    predictFastPassDiff = prevPredictFpDiff;
                }
                prevPredictFpDiff = predictFastPassDiff;
                for (var historyPoint of historyPointsInHour) {
                    var fastPassPrediction = (prediction.fastPassTime != null && predictFastPassDiff != null)? moment(prediction.fastPassTime.valueOf() + predictFastPassDiff * (historyPoint.minute / 60.0)): null;
                    var predictFpDiff = diffDateTimes(fastPassPrediction, prevFastPassPrediction);

                    if (prevHistoryPoint != null && fpDiff != null) {
                        var historicalFpDiff = diffDateTimes(hp.fastPassPrediction, prevHistoryPoint.fastPassPrediction);
                        var dtDiff = diffDateTimes(historyPoint.dateTime, prevHistoryPoint.dateTime);
                        
                        var historyM = historicalFpDiff / dtDiff;
                        var predictionM = predictFpDiff / dtDiff;
                        var fpAvailableDiff = diffDateTimes(now, historyPoint.dateTime);
                        historicalAdjustFactor += ((historyM / predictionM) - 1) * (dtDiff / ellapsedFastPassAvailableDiff) * (1.3 - (fpAvailableDiff / maxFastPassAvailableDiff));
                    }
                    prevFastPassPrediction = fastPassPrediction;
                    prevHistoryPoint = historyPoint;
                    
                    dps.push({
                        history: {
                            waitMins: historyPoint.waitMins,
                            fastPassTime: (historyPoint.fastPassTime != null)? historyPoint.fastPassTime.format("YYYY-MM-DD HH:mm:ss"): null,
                            status: historyPoint.status
                        },
                        prediction: {
                            waitMins: (prediction.waitMins * (1.0 - historyPoint.minute / 60.0)) + (nextPrediction.waitMins * (historyPoint.minute / 60.0))
                        },
                        dateTime: historyPoint.dateTime.format("YYYY-MM-DD HH:mm:ss")
                    });
                }
            } else {
                var dtDiff = diffDateTimes(prediction.dateTime, now);
                if (historicalAdjustFactor > 1.25) {
                    historicalAdjustFactor = 1.25;
                } else if (historicalAdjustFactor < 0.75) {
                    historicalAdjustFactor = 0.75;
                }
                var fpDiff = diffDateTimes(prediction.fastPassTime, prevFastPassPrediction);
                var fpDateTime = (prevHistoryPoint != null && prevHistoryPoint.fastPassTime != null)? prevHistoryPoint.fastPassTime.clone(): null;
                if (fpDateTime == null && prediction.fastPassTime != null) {
                    fpDateTime = prediction.fastPassTime.clone();
                }
                if (fpDateTime != null) {
                    var fpDiffFactor = (prevHistoryPoint != null)? ((historicalAdjustFactor - 1) * (1 - (dtDiff / (2 * 60 * 60 * 1000))) + 1): 1;
                    fpDateTime.add(fpDiff * fpDiffFactor, 'milliseconds');
                    prevHistoryPoint.fastPassTime = fpDateTime;
                }
                
                dps.push({
                    prediction: {
                        waitMins: prediction.waitMins,
                        fastPassTime: (fpDateTime != null)? fpDateTime.format("YYYY-MM-DD HH:mm:ss"): null
                    },
                    dateTime: prediction.dateTime.format("YYYY-MM-DD HH:mm:ss")
                });
            }
        });
        allRideDPs.push({
            rideID: rideID,
            dps: dps
        });
    }
    return allRideDPs;
}

async function updateRideInfoInDB(rideInfo, imgObjKey, query) {
    await query(`INSERT INTO Rides VALUES ?
        ON DUPLICATE KEY UPDATE name=?, height=?, labels=?, land=?`,
        [[[rideInfo.id, rideInfo.parkID, rideInfo.name, imgObjKey, rideInfo.height, rideInfo.labels, rideInfo.location, true]],
            rideInfo.name, rideInfo.height, rideInfo.labels, rideInfo.location]);
}

async function uploadRideImage(imgUrl, imgSizes, objKey, bucket, s3Client) {
    var readStream = request.get(imgUrl);
    await imgUploader.uploadImageStreamOfSizes(readStream, 
        imgSizes, 
        bucket,
        objKey,
        s3Client,
        true);
}

async function updateCustomRideName(rideID, customName, userID, query) {
    if (customName != null) {
        await query(`INSERT INTO CustomRideNames VALUES ?
            ON DUPLICATE KEY UPDATE name=?`, [[[rideID, userID, customName]], customName]);
    } else {
        await query(`DELETE FROM CustomRideNames WHERE 
            rideID=? AND userID=?`, [rideID, userID]);
    }
}

async function updateCustomRidePics(rideID, pics, imgSizes, userID, s3Client, query) {
    await query(`DELETE FROM CustomRidePics WHERE 
        rideID=? AND userID=?`, [rideID, userID]);
    var uploadPromises = [];
    var rows = [];
    pics.forEach((pic, i) => {
        var key = pic.url;
        if (pic.added) {
            key = `pics/${userID}/${uuidv4()}`;
            var base64Img = pic.url;
            base64Img = base64Img.substr(base64Img.indexOf(',') + 1);
            var buffer = Buffer.from(base64Img, 'base64');
            uploadPromises.push(imgUploader.uploadImageDataOfSizes(
                buffer, imgSizes, 'disneyapp3', key, s3Client, false
            ));
        }
        rows.push([rideID, userID, i, key]);
    });
    if (uploadPromises.length > 0) {
        await Promise.all(uploadPromises);
    }
    await query(`INSERT INTO CustomRidePics VALUES ?`,
        [rows]);
}

async function getCustomRideNames(userID, query) {
    var results = await query(`SELECT rideID, name FROM CustomRideNames WHERE
        userID=?`, [userID]);
    return commons.indexArray({}, results, "rideID", "name");
}

async function getCustomRidePics(userID, query) {
    var results = await query(`SELECT rideID, url FROM CustomRidePics WHERE
        userID=? ORDER BY rideID, priority`, [userID]);
    return commons.indexArray({}, results, "rideID", "url");
}

async function addRideInfo(rideInfo, imgSizes, bucket, s3Client, query) {
    var objKey = null;
    if (rideInfo.imgUrl != null) {
        objKey = 'rides/' + rideInfo.id.toString();
    }
    var promises = [];
    promises.push(updateRideInfoInDB(rideInfo, objKey, query));
    if (rideInfo.imgUrl != null) {
        promises.push(uploadRideImage(rideInfo.imgUrl, 
            imgSizes, objKey, bucket, s3Client));
    }
    await Promise.all(promises);
}

async function addRideInformations(resortID, imgSizes, bucket, s3Client, query) {
    var parkNamesToID = {};
    var parks = await resortManager.getParks(resortID, query);
    for (var park of parks) {
        parkNamesToID[park["urlName"]] = park["id"];
    }

    var sortedImgSizes = imgSizes.sort((i1, i2) => { return i1 - i2; });
    var maxImgSize = sortedImgSizes[sortedImgSizes.length - 1];
    var rideInfos = await rides.getRideInfos(maxImgSize);
    for (var rideInfo of rideInfos) {
        var parkID = parkNamesToID[rideInfo.parkUrlName];
        if (parkID != null) {
            rideInfo.parkID = parkID;
            await addRideInfo(rideInfo, imgSizes, bucket, s3Client, query);
        }
    }
}

async function getSavedRides(query, onlyActive = false) {
    var filter = onlyActive? "WHERE (datediff(CURDATE(), DATE(lrt.lastChangeTime)) <= 2 OR lrt.waitMins IS NOT NULL)": "";
    var savedRideTimes = await query(`SELECT 
        r.id AS id,
        r.parkID AS parkID,
        r.name AS name,
        r.imgUrl AS imgUrl,
        r.height AS height,
        r.labels AS labels,
        r.land AS land,
        lrt.rideID AS lrtRideID, 
        lrt.waitMins AS waitMins,
        lrt.fastPassTime AS fastPassTime,
        lrt.status AS status,
        lrt.lastStatusTime AS lastStatusTime,
        lrt.lastStatusRange AS lastStatusRange,
        lrt.lastChangeTime AS lastChangeTime,
        lrt.lastChangeRange AS lastChangeRange
        FROM Rides r 
        LEFT JOIN LatestRideTimes lrt ON r.id=lrt.rideID
        ${filter}`);
    return savedRideTimes;
}

async function getUpdatedRideTimes(rideTimes, query) {
    var savedRideTimes = await getSavedRides(query);

    var rideIDToSavedRides = {};
    for (var savedRT of savedRideTimes) {
        rideIDToSavedRides[savedRT.id] = savedRT;
    }
    var updatedRides = [];
    for (var rideTime of rideTimes) {
        var savedRideTime = rideIDToSavedRides[rideTime.id];
        if (savedRideTime != null) {
            rideTime.waitMinsUpdated = false;
            rideTime.fpTimeUpdated = false;
            rideTime.statusUpdated = false;
            if (savedRideTime.waitMins != rideTime.waitMins) {
                rideTime.waitMinsUpdated = true;
            } 
            if (savedRideTime.fastPassTime != rideTime.fastPassTime) {
                rideTime.fpTimeUpdated = true;
            }
            if (savedRideTime.status != rideTime.status) {
                rideTime.statusUpdated = true;
            }
            if (rideTime.waitMinsUpdated || rideTime.fpTimeUpdated || rideTime.statusUpdated) {
                updatedRides.push(rideTime);
            }
        }
    }
    return updatedRides;
}

async function saveLatestRideTimes(updatedRideTimes, tz, query) {
    var nowStr = moment().tz(tz).format("YYYY-MM-DD HH:mm:ss");
    
    for (var rideTime of updatedRideTimes) {
        var fpTimeStr = (rideTime.fastPassTime != null)? `"${moment(rideTime.fastPassTime).format("HH:mm:ss")}"`: `null`;
        await query(`INSERT INTO LatestRideTimes VALUES (
            ${rideTime.id}, 
            "${nowStr}", 
            ${rideTime.waitMins}, 
            ${fpTimeStr}, 
            "${rideTime.status}", 
            0, 
            "${nowStr}",
            "${nowStr}", 
            0) 
            ON DUPLICATE KEY UPDATE 
            lastChangeRange=IF(${rideTime.waitMinsUpdated}=1, IF(DAY("${nowStr}") - DAY(dateTime) < 2, TIMEDIFF("${nowStr}", dateTime), 0), lastChangeRange), 
            lastChangeTime=IF(${rideTime.waitMinsUpdated}=1, "${nowStr}", lastChangeTime), fastPassTime=${fpTimeStr},
            lastStatusRange=IF(${rideTime.statusUpdated}, lastStatusRange, IF(DAY("${nowStr}") - DAY(dateTime) < 2, TIMEDIFF("${nowStr}", dateTime), 0)), lastStatusTime=IF(status="${rideTime.status}", 
            lastStatusTime, "${nowStr}"), waitMins=${rideTime.waitMins}, status="${rideTime.status}", dateTime="${nowStr}"`);
    }
}

async function removeNonExistantRides(rideTimes, query) {
    var savedRideTimes = await getSavedRides(query);
    var existingRideIDs = {};
    for (var savedRT of savedRideTimes) {
        existingRideIDs[savedRT.id] = true;
    }
    var existingRideTimes = [];
    for (var rideTime of rideTimes) {
        if (existingRideIDs[rideTime.id]) {
            existingRideTimes.push(rideTime);
        }
    }
    return existingRideTimes;
}

async function saveToHistoricalRideTimes(rideTimes, tz, query) {
    var nowStr = moment().tz(tz).format("YYYY-MM-DD HH:mm:ss");
    var rows = [];
    for (var rideTime of rideTimes) {
        var fpTimeStr = (rideTime.fastPassTime != null)? rideTime.fastPassTime.format("HH:mm:ss"): null;
        rows.push([rideTime.id, nowStr, rideTime.waitMins, fpTimeStr, rideTime.status]);
    }
    
    await query(`INSERT IGNORE INTO RideTimes VALUES ?`, [rows]);
}

module.exports = {
    addRideInformations: addRideInformations,
    getSavedRides: getSavedRides,
    getRideDPs: getRideDPs,
    getUpdatedRideTimes: getUpdatedRideTimes,
    saveLatestRideTimes: saveLatestRideTimes,
    saveToHistoricalRideTimes: saveToHistoricalRideTimes,
    updateCustomRideName: updateCustomRideName,
    updateCustomRidePics: updateCustomRidePics,
    getCustomRideNames: getCustomRideNames,
    getCustomRidePics: getCustomRidePics
};