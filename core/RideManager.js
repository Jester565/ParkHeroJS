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
        getSavedRides(query, true),
        query(`SELECT dateTime FROM LatestRideUpdateDateTimes ORDER BY dateTime DESC LIMIT 1`)
    ];
    var queryResults = await Promise.all(queryPromises);
    var allRidePredictions = queryResults[0];
    var allRideHistory = queryResults[1];
    var rides = queryResults[2];
    var latestUpdateDTs = queryResults[3];
    var latestUpdateDateTime = null;
    if (latestUpdateDTs != null && latestUpdateDTs.length > 0) {
        latestUpdateDateTime = moment(latestUpdateDTs[0].dateTime).tz(tz, true);
    }

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
            rideHistory.push({
                hour: Math.trunc(latestUpdateDateTime.hours()),
                waitMins: ride.waitMins,
                fastPassTime: moment(now.format("YYYY-MM-DD") + " " + ride.fastPassTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true),
                dateTime: latestUpdateDateTime.clone(),
                minute: Math.trunc(latestUpdateDateTime.minutes()),
                current: true
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
                        if (fpAvailableDiff > 25 * 60 * 1000) {
                            var delta = ((historyM / predictionM) - 1) * (dtDiff / maxFastPassAvailableDiff) * (1.3 - (fpAvailableDiff / maxFastPassAvailableDiff));
                            historicalAdjustFactor += delta;
                        }
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
                        fastPassTimeParsed: historyPoint.fastPassTime,
                        dateTime: historyPoint.dateTime.format("YYYY-MM-DD HH:mm:ss"),
                        dateTimeParsed: historyPoint.dateTime
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
                        fastPassTime: (fpDateTime != null)? fpDateTime.format("YYYY-MM-DD HH:mm:ss"): null,
                    },
                    waitMins: prediction.waitMins,
                    fastPassTime: (fpDateTime != null)? fpDateTime.format("YYYY-MM-DD HH:mm:ss"): null,
                    fastPassTimeParsed: fpDateTime,
                    dateTime: prediction.dateTime.format("YYYY-MM-DD HH:mm:ss"),
                    dateTimeParsed: prediction.dateTime
                });
            }
        });
        allRideDPs.push({
            rideID: rideID,
            rideOfficialName: ride.name,
            rideOfficialPicUrl: ride.imgUrl,
            rideLabels: ride.labels,
            dps: dps,
            rideOpenDateTime: (rideOpenDateTime != null)? rideOpenDateTime.format("YYYY-MM-DD HH:mm:ss"): null,
            rideCloseDateTime: (rideCloseDateTime != null)? rideCloseDateTime.format("YYYY-MM-DD HH:mm:ss"): null
        });
    }
    return allRideDPs;
}

async function getPredictedFastPassTime(attractionID, dateTime, tz, query) {
    try {
        var date = dateTime.clone().subtract(4, 'hours');
        var allRideDPs = await getRideDPs(date, dateTime.clone(), tz, query, attractionID);
        var predictedFastPassTime = null;
        if (allRideDPs.length > 0) {
            var rideDPs = allRideDPs[0];
            var fastPassEndDateTime = null;
            if (rideDPs.rideCloseDateTime != null) {
                fastPassEndDateTime = moment(rideDPs.rideCloseDateTime, "YYYY-MM-DD HH:mm:ss").tz(tz, true);
            }
            var lowerRideDP = null;
            if (rideDPs.dps != null) {
                for (var rideDP of rideDPs.dps) {
                    if (rideDP.dateTimeParsed <= dateTime) {
                        lowerRideDP = rideDP;
                    }
                    if (rideDP.dateTimeParsed >= dateTime) {
                        if (lowerRideDP != null && lowerRideDP.fastPassTimeParsed != null && rideDP.fastPassTimeParsed != null) {
                            var nowLowerTimeDiff = moment.duration(dateTime.diff(lowerRideDP.dateTimeParsed));
                            var nowLowerMinsDiff = nowLowerTimeDiff.asMinutes();
                            var dateTimeDiff = moment.duration(rideDP.dateTimeParsed.diff(lowerRideDP.dateTimeParsed));
                            var dateTimeMinsDiff = dateTimeDiff.asMinutes();
                            var fastPassTimeDiff = moment.duration(rideDP.fastPassTimeParsed.diff(lowerRideDP.fastPassTimeParsed));
                            var fastPassMinsDiff = fastPassTimeDiff.asMinutes();
                            if (dateTimeMinsDiff > 0) {
                                predictedFastPassTime = lowerRideDP.fastPassTimeParsed.clone().add((nowLowerMinsDiff / dateTimeMinsDiff) * fastPassMinsDiff);
                                if (fastPassEndDateTime != null && predictedFastPassTime != null && predictedFastPassTime > fastPassEndDateTime) {
                                    predictedFastPassTime = null;
                                }
                                return predictedFastPassTime;
                            } else {
                                predictedFastPassTime = lowerRideDP.fastPassTimeParsed.clone();
                                if (fastPassEndDateTime != null && predictedFastPassTime != null && predictedFastPassTime > fastPassEndDateTime) {
                                    predictedFastPassTime = null;
                                }
                                return predictedFastPassTime;
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log("GET PREDICTED TIME ERROR: ", JSON.stringify(e, null, 2));
        return null;
    }
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

async function updateCustomAttractionName(attractionID, customName, userID, query) {
    if (customName != null) {
        await query(`INSERT INTO CustomAttractionNames VALUES ?
            ON DUPLICATE KEY UPDATE name=?`, [[[attractionID, userID, customName]], customName]);
    } else {
        await query(`DELETE FROM CustomAttractionNames WHERE 
            attractionID=? AND userID=?`, [attractionID, userID]);
    }
}

async function updateCustomAttractionPics(attractionID, pics, imgSizes, userID, s3Client, query) {
    await query(`DELETE FROM CustomAttractionPics WHERE 
        attractionID=? AND userID=?`, [attractionID, userID]);
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
        rows.push([attractionID, userID, i, key]);
    });
    if (uploadPromises.length > 0) {
        await Promise.all(uploadPromises);
    }
    await query(`INSERT INTO CustomAttractionPics VALUES ?`,
        [rows]);
}

async function getCustomAttractionNames(userID, query) {
    var results = await query(`SELECT attractionID, name FROM CustomAttractionNames WHERE
        userID=?`, [userID]);
    return commons.indexArray({}, results, "attractionID", "name");
}

async function getCustomAttractionPics(userID, query) {
    var results = await query(`SELECT attractionID, url FROM CustomAttractionPics WHERE
        userID=? ORDER BY attractionID, priority`, [userID]);
    return commons.indexArray({}, results, "attractionID", "url");
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

async function getAttractionInfo(attractionID, userID, query) {
    var attractionInfos = await query(`SELECT name AS officalName, imgUrl AS officialPicUrl, land, height, labels FROM Rides WHERE id=?`, attractionID);
    if (attractionInfos.length == 0) {
        attractionInfos = await query(`SELECT name AS officialName, imgUrl AS officialPicUrl, location AS land FROM Events WHERE id=?`, attractionID);
    }
    var attractionInfo = attractionInfos[0];
    var customInfoPromises = [
        getCustomAttractionNames(userID, query),
        getCustomAttractionPics(userID, query)
    ];

    var customInfos = await Promise.all(customInfoPromises);
    var customNames = customInfos[0];
    var customPics = customInfos[1];

    var customNameArr = customNames[attractionID];
    var customAttractionPics = customPics[attractionID];
    attractionInfo.name = (customNameArr)? customNameArr[0]: attractionInfo["officialName"];
    attractionInfo.picUrl = (customAttractionPics)? customAttractionPics[0]: attractionInfo["officialPicUrl"];
    attractionInfo.customPicUrls = customAttractionPics;
    return attractionInfo;
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

async function getFilters(userID, tz, query) {
    var nowStr = moment().tz(tz).subtract(4, 'hours').format("YYYY-MM-DD");
    var results = await query(`SELECT fr.attractionID AS attractionID, wf.name AS name, wf.type AS type, wf.waitMins AS waitMins, wf.waitRating AS waitRating, wf.fastPassTime AS fastPassTime, wf.watchDate AS watchDate
        FROM FilterAttractions fr INNER JOIN Filters wf ON wf.name=fr.name AND wf.userID=fr.userID AND wf.type=fr.type WHERE wf.userID=? ORDER BY wf.name`, [userID]);

    var filters = [];
    var lastRow = null;
    var attractionIDs = [];
    var addFilter = () => {
        var filter = {
            name: lastRow.name,
            type: lastRow.type,
            attractionIDs: attractionIDs
        };
        if (lastRow.watchDate != null && moment(lastRow.watchDate).format("YYYY-MM-DD") == nowStr) {
            filter.watchConfig = {
                waitTime: lastRow.waitMins,
                waitRating: lastRow.waitRating,
                fastPassTime: lastRow.fastPassTime
            };
        }
        filters.push(filter);
    };
    for (var result of results) {
        if (lastRow != null && result.name != lastRow.name) {
            addFilter();
            attractionIDs = [];
        }
        attractionIDs.push(result.attractionID);
        lastRow = result;
    }
    if (lastRow != null) {
        addFilter();
    }
    return filters;
}

async function updateFilter(filterName, attractionIDs, filterType, watchConfig, userID, tz, query) {
    await query(`DELETE FROM Filters WHERE name=? AND userID=? AND type=?`, [filterName, userID, filterType]);
    var filterAttractions = [];
    for (var attractionID of attractionIDs) {
        filterAttractions.push([
            filterName, 
            userID, 
            filterType,
            attractionID
        ]);
    }
    await query(`INSERT INTO Filters VALUES ?`, [[[
        filterName, 
        userID, 
        filterType,
        (watchConfig != null)? watchConfig.waitTime: null,
        (watchConfig != null)? watchConfig.waitRating: null,
        (watchConfig != null)? watchConfig.fastPassTime: null,
        (watchConfig != null)? moment().tz(tz).subtract(4, 'hours').format("YYYY-MM-DD"): null]]]);
    await query(`INSERT INTO FilterAttractions VALUES ?`, [filterAttractions]);
}

async function deleteFilters(filterNames, filterType, userID, query) {
    await query(`DELETE FROM Filters WHERE name IN (?) AND type=? AND userID=?`, [filterNames, filterType, userID]);
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
    var now = moment().tz(tz);
    var nowStr = now.format("YYYY-MM-DD HH:mm:ss");
    var nowNextHourDateTime = now.clone().add(1, 'hours');
    
    var dateStr = now.subtract(4, 'hours').format("YYYY-MM-DD");
    /*
    var nowPredictionPromises = [
        predictionManager.getPredictTimeHeuristics(now, query), 
        predictionManager.getPredictTime(now, query), 
        predictionManager.getPredictTime(nowNextHourDateTime, query)];
    */
    var savedRideDateTimeResult = await query(`SELECT dateTime FROM LatestRideUpdateDateTimes ORDER BY dateTime DESC LIMIT 1`);
    var savedRideDateTime = moment(savedRideDateTimeResult[0].dateTime).tz(tz, true);
    var savedRideDateTimeNextHour = savedRideDateTime.clone().add(1, 'hours');
    var savedRideDateTimeStr = savedRideDateTime.format("YYYY-MM-DD HH:mm:ss");
    /*
    var savedPredictionPromises = [
        predictionManager.getPredictTimeHeuristics(savedRideDateTime, query),
        predictionManager.getPredictTime(savedRideDateTime, query),
        predictionManager.getPredictTime(savedRideDateTimeNextHour, query)];
    */
    var savedRides = await getSavedRides(query);
    var savedRidesMap = commons.indexArray({}, savedRides, 'id');
    var updatedRidesMap = commons.indexArray({}, updatedRides, 'id', null, false);

    var updatedRideIDs = [];
    for (var ride of updatedRides) {
        updatedRideIDs.push(ride.id);
    }
    var filters = await query(`SELECT wf.userID AS userID, fr.attractionID AS rideID, crn.name AS customRideName,
        wf.waitMins AS waitMins, wf.waitRating AS waitRating, wf.fastPassTime AS fastPassTime
        FROM Filters wf
        INNER JOIN FilterAttractions fr ON wf.name=fr.name AND wf.userID=fr.userID AND wf.type=fr.type
        INNER JOIN Rides r ON fr.attractionID=r.id
        LEFT JOIN CustomAttractionNames crn ON crn.attractionID=fr.attractionID AND crn.userID=wf.userID
        WHERE wf.watchDate=? AND fr.attractionID IN (?) ORDER BY wf.userID`, [dateStr, updatedRideIDs]);

    //var nowPredictionResults = await Promise.all(nowPredictionPromises);
    //var savedPredictionResults = await Promise.all(savedPredictionPromises);
    var prevUserID = null;
    var allUpdates = [];
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
        
        var update = null;
        if (filter.waitMins != null && updatedRide.waitMins != null && updatedRide.waitMins <= filter.waitMins && (savedRide.waitMins == null || savedRide.waitMins > filter.waitMins)) {
            if (update == null) {
                update = {};
            }
            update.waitMins = {
                updated: updatedRide.waitMins,
                old: savedRide.waitMins
            };
        }
        /*
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
        */
        if (filter.fastPassTime != null) {
            var fastPassTime = moment(filter.fastPassTime).tz(tz, true);
            var updatedFastPassTime = moment(updatedRide.fastPassTime).tz(tz, true);
            var savedFastPassTime = moment(savedRide.fastPassTime, "HH:mm:ss").tz(tz, true);
            if (updatedFastPassTime >= fastPassTime && savedFastPassTime < fastPassTime) {
                if (update == null) {
                    update = {};
                }
                update.fastPassTime = {
                    updated: updatedFastPassTime.format("YYYY-MM-DD HH:mm:ss"),
                    old: savedFastPassTime.format("YYYY-MM-DD HH:mm:ss")
                };
            }
        }
        //Send notification if the ride has reopened after
        if (updatedRide.status != savedRide.status && savedRide.status == "Down" && updatedRide.status == "Operating") {
            var closeDateTime = moment(savedRide.lastStatusChangeDateTime).tz(tz, true);
            closeDateTime.subtract(savedRide.lastStatusChangeOffset, 'milliseconds');
            var closedDuration = now.valueOf() - closeDateTime.valueOf();
            var closedMins = Math.round(closedDuration / (60 * 1000));
            if (update == null) {
                update = {};
            }
            update.closedMins = closedMins;
        }
        if (update != null) {
            update.rideID = filter.rideID;
            update.rideName = (filter.customRideName != null)? filter.customRideName: savedRide.name;
            update.picUrl = savedRide.imgUrl;
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
    updateCustomAttractionName: updateCustomAttractionName,
    updateCustomAttractionPics: updateCustomAttractionPics,
    getCustomAttractionNames: getCustomAttractionNames,
    getCustomAttractionPics: getCustomAttractionPics,
    getFilters: getFilters,
    updateFilter: updateFilter,
    deleteFilters: deleteFilters,
    getWaitRating: getWaitRating,
    getWatchUpdates: getWatchUpdates,
    getAttractionInfo: getAttractionInfo,
    getPredictedFastPassTime: getPredictedFastPassTime
};