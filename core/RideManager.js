var rides = require('../dis/Ride');
var request = require('request');
var imgUploader = require('./ImageUploader');
var resortManager = require('./ResortManager');
var moment = require('moment-timezone');
var predictionManager =require('./Predictions');
var uuidv4 = require('uuid/v4');
var commons = require('./Commons');

var NOTIFY_CLOSE_MINS = 15;

async function getRideHistory(date, tz, query, rideID=null) {
    var args = [ date.format("YYYY-MM-DD") ];
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

function diffDateTimes(dt1, dt2) {
    if (dt1 != null && dt2 != null) {
        return dt1.valueOf() - dt2.valueOf();
    }
    return null;
}

async function getRideDPs(date, now, tz, query, filterRideID = null) {
    var queryPromises = [
        predictionManager.getPredictions(date, tz, query, filterRideID),
        getRideHistory(date, tz, query, filterRideID),
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
        if (filterRideID != null && rideID != filterRideID) {
            continue;
        }
        var ridePredictions = allRidePredictions[rideID];
        var rideHistory = allRideHistory[rideID];
        if (ridePredictions == null) {
            continue;
        }

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
        
        var rideOpenDateTime = (ridePredictions.length > 0)? ridePredictions[0].dateTime: null;
        var rideCloseDateTime = (ridePredictions.length > 0)? ridePredictions[ridePredictions.length - 1].dateTime: null;
        var fastPassesGone = false;
        var dps = [];
        ridePredictions.forEach((prediction, i) => {
            if (rideHistory != null && historyI < rideHistory.length) {
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
                    var prevFpDiff = diffDateTimes(fastPassPrediction, prevFastPassPrediction);
            
                    if (prevHistoryPoint != null && prevFpDiff != null && historyPoint.fastPassTime != null && prevHistoryPoint.fastPassTime != null) {
                        var historicalFpDiff = diffDateTimes(historyPoint.fastPassTime, prevHistoryPoint.fastPassTime);
                        var dtDiff = diffDateTimes(historyPoint.dateTime, prevHistoryPoint.dateTime);
                        
                        var historyM = historicalFpDiff / dtDiff;
                        var predictionM = prevFpDiff / dtDiff;
                        var fpAvailableDiff = diffDateTimes(now, historyPoint.dateTime);
                        var delta = ((historyM / predictionM) - 1) * (dtDiff / maxFastPassAvailableDiff) * (1.3 - (fpAvailableDiff / maxFastPassAvailableDiff));
                        historicalAdjustFactor += delta;
                    } else if (historyPoint.fastPassTime == null && prevHistoryPoint != null) {
                        fastPassesGone = true;
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
                            waitMins: (nextPrediction != null)? (prediction.waitMins * (1.0 - historyPoint.minute / 60.0)) + (nextPrediction.waitMins * (historyPoint.minute / 60.0)): prediction.waitMins
                        },
                        waitMins: historyPoint.waitMins,
                        fastPassTime: (historyPoint.fastPassTime != null)? historyPoint.fastPassTime.format("YYYY-MM-DD HH:mm:ss"): null,
                        dateTime: historyPoint.dateTime.format("YYYY-MM-DD HH:mm:ss")
                    });
                }
            } else {
                var fpDateTime = null;
                if (!fastPassesGone) {
                    var dtDiff = diffDateTimes(prediction.dateTime, now);
                    var fpDiff = diffDateTimes(prediction.fastPassTime, prevFastPassPrediction);
                    if (fpDiff == null) {
                        fpDiff = prevPredictFpDiff;
                    }
                    prevFastPassPrediction = prediction.fastPassTime;
                    prevPredictFpDiff = fpDiff;
                    fpDateTime = (prevHistoryPoint != null && prevHistoryPoint.fastPassTime != null)? prevHistoryPoint.fastPassTime.clone(): null;
                    if (fpDateTime == null && prediction.fastPassTime != null) {
                        fpDateTime = prediction.fastPassTime.clone();
                    }
                    if (fpDateTime != null) {
                        var fpDiffFactor = (prevHistoryPoint != null && dtDiff <= 3 * 60 * 60 * 1000)? ((historicalAdjustFactor - 1) * (1 - (dtDiff / (2 * 60 * 60 * 1000))) + 1): 1;
                        fpDateTime.add(fpDiff * fpDiffFactor, 'milliseconds');
                        if (fpDateTime < prediction.dateTime) {
                            fpDateTime = prediction.dateTime;
                        }
                        if (prevHistoryPoint == null) {
                            prevHistoryPoint = {};
                        }
                        prevHistoryPoint.fastPassTime = fpDateTime;
                    }
                }
                
                dps.push({
                    prediction: {
                        waitMins: prediction.waitMins,
                        fastPassTime: (fpDateTime != null)? fpDateTime.format("YYYY-MM-DD HH:mm:ss"): null
                    },
                    waitMins: prediction.waitMins,
                    fastPassTime: (fpDateTime != null)? fpDateTime.format("YYYY-MM-DD HH:mm:ss"): null,
                    dateTime: prediction.dateTime.format("YYYY-MM-DD HH:mm:ss")
                });
            }
        });
        allRideDPs.push({
            rideID: rideID,
            dps: dps,
            rideOpenDateTime: (rideOpenDateTime != null)? rideOpenDateTime.format("YYYY-MM-DD HH:mm:ss"): null,
            rideCloseDateTime: (rideCloseDateTime != null)? rideCloseDateTime.format("YYYY-MM-DD HH:mm:ss"): null
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
    var filter = onlyActive? "WHERE (datediff(CURDATE(), DATE(lrt.lastWaitChangeDateTime)) <= 2 OR lrt.waitMins IS NOT NULL)": "";
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
        lrt.lastStatusChangeDateTime AS lastStatusChangeDateTime,
        lrt.lastWaitChangeDateTime AS lastWaitChangeDateTime,
        lrt.lastStatusChangeOffset AS lastStatusChangeOffset,
        lrt.lastWaitChangeOffset AS lastWaitChangeOffset
        FROM Rides r 
        LEFT JOIN LatestRideTimes lrt ON r.id=lrt.rideID
        ${filter}`);
    return savedRideTimes;
}

async function getUpdatedRideTimes(rideTimes, query, savedRideTimes = null) {
    if (savedRideTimes == null) {
        savedRideTimes = await getSavedRides(query);
    }

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
    var now = moment().tz(tz);
    var nowStr = now.format("YYYY-MM-DD HH:mm:ss");

    var savedRideDateTimeResult = await query(`SELECT dateTime FROM LatestRideUpdateDateTimes ORDER BY dateTime DESC LIMIT 1`);
    var savedRideDateTime = moment().tz(tz);
    if (savedRideDateTimeResult != null && savedRideDateTimeResult.length > 0) {
        savedRideDateTime = moment(savedRideDateTimeResult[0].dateTime).tz(tz, true);   
    }

    var savedTimeDiff = now.valueOf() - savedRideDateTime.valueOf();
    
    for (var rideTime of updatedRideTimes) {
        var fpTimeStr = (rideTime.fastPassTime != null)? `"${moment(rideTime.fastPassTime).format("HH:mm:ss")}"`: `null`;
        await query(`INSERT INTO LatestRideTimes VALUES (
            ${rideTime.id}, 
            "${nowStr}", 
            ${rideTime.waitMins}, 
            ${fpTimeStr}, 
            "${rideTime.status}", 
            "${nowStr}",
            "${nowStr}", 
            ${savedTimeDiff},
            ${savedTimeDiff}) 
            ON DUPLICATE KEY UPDATE 
            lastWaitChangeDateTime=IF(${rideTime.waitMinsUpdated}=1, "${nowStr}", lastWaitChangeDateTime), 
            lastWaitChangeOffset=IF(${rideTime.waitMinsUpdated}=1, ${savedTimeDiff}, lastWaitChangeOffset), 
            lastStatusChangeDateTime=IF(${rideTime.statusUpdated}=1, "${nowStr}", lastStatusChangeDateTime), 
            lastStatusChangeOffset=IF(${rideTime.statusUpdated}=1, ${savedTimeDiff}, lastStatusChangeOffset), 
            waitMins=${rideTime.waitMins}, 
            fastPassTime=${fpTimeStr},
            status="${rideTime.status}", 
            dateTime="${nowStr}"`);
    }
    await query(`INSERT INTO LatestRideUpdateDateTimes VALUES ?`, [[[nowStr]]]);
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

async function getFilters(userID, query) {
    var nowStr = moment().subtract(4, 'hours').format("YYYY-MM-DD");
    var results = await query(`SELECT fr.rideID AS rideID, wf.name AS name, wf.waitMins AS waitMins, wf.waitRating AS waitRating, wf.fastPassTime AS fastPassTime, wf.watchDate AS watchDate
        FROM FilterRides fr INNER JOIN WatchFilters wf ON wf.name=fr.name AND wf.userID=fr.userID WHERE wf.userID=? ORDER BY wf.name`, [userID]);

    var filters = [];
    var lastRow = null;
    var rideIDs = [];
    var addFilter = () => {
        var filter = {
            name: lastRow.name,
            rideIDs: rideIDs
        }
        if (lastRow.watchDate != null && moment(lastRow.watchDate).format("YYYY-MM-DD") == nowStr) {
            filter.watchConfig = {
                waitTime: lastRow.waitMins,
                waitRating: lastRow.waitRating,
                fastPassTime: lastRow.fastPassTime,
            };
        }
        filters.push(filter);
    }
    for (var result of results) {
        if (lastRow != null && result.name != lastRow.name) {
            addFilter();
            rideIDs = [];
        }
        rideIDs.push(result.rideID);
        lastRow = result;
    }
    if (lastRow != null) {
        addFilter();
    }
    return filters;
}

async function updateFilter(filterName, rideIDs, watchConfig, userID, query) {
    await query(`DELETE FROM WatchFilters WHERE name=? AND userID=?`, [filterName, userID]);
    var filterRides = [];
    for (var rideID of rideIDs) {
        filterRides.push([
            filterName, 
            userID, 
            rideID
        ]);
    }
    await query(`INSERT INTO WatchFilters VALUES ?`, [[[
        filterName, 
        userID, 
        (watchConfig != null)? watchConfig.waitTime: null,
        (watchConfig != null)? watchConfig.waitRating: null,
        (watchConfig != null)? watchConfig.fastPassTime: null,
        (watchConfig != null)? moment().subtract(4, 'hours').format("YYYY-MM-DD"): null]]]);
    await query(`INSERT INTO FilterRides VALUES ?`, [filterRides]);
}

async function deleteFilters(filterNames, userID, query) {
    await query(`DELETE FROM WatchFilters WHERE name IN (?) AND userID=?`, [filterNames, userID]);
}

function getWaitRating(rideTime, predictions) {
    var id = rideTime["id"].toString();
    var predictTimeHeuristic = predictions[0][id];
    var avgWaitMins = null;
    var minWaitMins = null;
    var maxWaitMins = null;
    if (predictTimeHeuristic != null) {
        avgWaitMins = predictTimeHeuristic[0]["avgWaitMins"];
        minWaitMins = predictTimeHeuristic[0]["minWaitMins"];
        maxWaitMins = predictTimeHeuristic[0]["maxWaitMins"];
    }
    var firstPrediction = predictions[1][id];
    var secondPrediction = predictions[2][id];
    var firstPredictionWaitMins = null;
    var secondPredictionWaitMins = null;
    
    if (firstPrediction != null) {
        firstPredictionWaitMins = firstPrediction[0]["waitMins"];
    }
    if (secondPrediction != null) {
        secondPredictionWaitMins = secondPrediction[0]["waitMins"];
    }
    var waitRating = predictionManager.getWaitRating(rideTime["waitMins"], avgWaitMins, minWaitMins, maxWaitMins, firstPredictionWaitMins, secondPredictionWaitMins);
    return waitRating;
}

async function getWatchUpdates(updatedRides, tz, query) {
    if (updatedRides == null || updatedRides.length == 0) {
        return [];
    }
    var dateStr = now.subtract(4, 'hours').format("YYYY-MM-DD");
    var now = moment().tz(tz);
    var nowStr = now.format("YYYY-MM-DD HH:mm:ss");
    var nowNextHourDateTime = now.clone().add(1, 'hours');

    var nowPredictionPromises = [
        predictionManager.getPredictTimeHeuristics(now, query), 
        predictionManager.getPredictTime(now, query), 
        predictionManager.getPredictTime(nowNextHourDateTime, query)];
    
    var savedRideDateTimeResult = await query(`SELECT dateTime FROM LatestRideUpdateDateTimes ORDER BY dateTime DESC LIMIT 1`);
    var savedRideDateTime = moment(savedRideDateTimeResult[0].dateTime).tz(tz, true);
    var savedRideDateTimeNextHour = savedRideDateTime.clone().add(1, 'hours');
    var savedRideDateTimeStr = savedRideDateTime.format("YYYY-MM-DD HH:mm:ss");
    var savedPredictionPromises = [
        predictionManager.getPredictTimeHeuristics(savedRideDateTime, query),
        predictionManager.getPredictTime(savedRideDateTime, query),
        predictionManager.getPredictTime(savedRideDateTimeNextHour, query)];
    
    var savedRides = await getSavedRides(query);
    var savedRidesMap = commons.indexArray({}, savedRides, 'id');
    var updatedRidesMap = commons.indexArray({}, updatedRides, 'id');

    var updatedRideIDs = [];
    for (var ride of updatedRides) {
        updatedRideIDs.push(ride.id);
    }
    var filters = await query(`SELECT wf.userID AS userID, fr.rideID AS rideID, wf.waitMins AS waitMins, wf.waitRating AS waitRating, wf.fastPassTime
        FROM WatchFilters wf
        INNER JOIN FilterRides fr ON wf.name=fr.name AND wf.userID=fr.userID
        WHERE wf.watchDate=? AND fr.rideID IN (?) ORDER BY wf.userID`, [dateStr, updatedRideIDs]);

    var nowPredictionResults = Promise.all(nowPredictionPromises);
    var savedPredictionResults = Promise.all(savedPredictionPromises);
    var prevUserID = null;
    var userUpdates = [];
    for (var filter of filters) {
        if (filter.userID != prevUserID && userUpdates.length > 0) {
            allUpdates.push({
                userID: prevUserID,
                updates: userUpdates
            });
            userUpdates = [];
        }
        prevUserID = filter.userID;
        if (savedRidesMap[filter.rideID] == null) {
            continue;
        }
        var savedRide = savedRidesMap[filter.rideID][0];
        var updatedRide = updatedRidesMap[filter.rideID][0];
        var update = {};
        if (filter.waitMins != null && updatedRide.waitMins != null && updatedRide.waitMins <= filter.waitMins && (savedRide.waitMins == null || savedRide.waitMins > filter.waitMins)) {
            if (update == null) {
                update = {};
            }
            update.waitMins = {
                updated: updatedRide.waitMins,
                old: savedRide.waitMins
            }
        }
        if (filter.waitRating != null) {
            var updatedWaitRaiting = getWaitRating(updatedRide, nowPredictionResults);
            var savedWaitRating = getWaitRating(savedRide, savedPredictionResults);
            
            if (updatedWaitRaiting >= filter.waitRating && (savedWaitRating == null || savedWaitRating < filter.waitRating)) {
                if (update == null) {
                    update = {};
                }
                update.waitRating = {
                    updated: updatedRide.waitMins,
                    old: savedRide.waitMins
                };
            }
        }
        if (filter.fastPassTime != null) {
            var fastPassTime = moment(filter.fastPassTime).tz(tz, true);
            var updatedFastPassTime = moment(updatedRide.fastPassTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true);
            var savedFastPassTime = moment(savedRide.fastPassTime).tz(tz, true);
            if (updatedFastPassTime >= fastPassTime && savedFastPassTime < fastPassTime) {
                if (update == null) {
                    update = {};
                }
                update.fastPassTime = {
                    updated: updatedFastPassTime.format("YYYY-MM-DD HH:mm:ss"),
                    old: savedFastPassTime.format("YYYY-MM-DD HH:mm:ss")
                }
            }
        }
        //Send notification if the ride has reopened after
        if (updatedRide.status != savedRide.status && updatedRide.status == "Operating") {
            var closeDateTime = moment(savedRide.lastStatusChangeDateTime).tz(tz, true);
            closeDateTime.subtract(savedRide.lastStatusChangeOffset, 'milliseconds');
            var closedDuration = now.valueOf() - closeDateTime.valueOf();
            var closedMins = Math.round(closedDuration / (60 * 1000));
            if (closedMins >= NOTIFY_CLOSE_MINS) {
                if (update == null) {
                    update = {};
                }
                update.closedMins = closedMins;
            }
        }
        if (update != null) {
            userUpdates.push(update);
        }
    }
    if (userUpdates.length > 0) {
        allUpdates.push({
            userID: prevUserID,
            updates: userUpdates,
            dateTime: nowStr,
            prevCheckDateTime: savedRideDateTimeStr
        });
    }
    return allUpdates;
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
    getCustomRidePics: getCustomRidePics,
    getFilters: getFilters,
    updateFilter: updateFilter,
    deleteFilters: deleteFilters,
    getWatchUpdates: getWatchUpdates
};