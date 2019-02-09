var rides = require('../dis/Ride');
var request = require('request');
var imgUploader = require('./ImageUploader');
var resortManager = require('./ResortManager');
var moment = require('moment-timezone');

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
        s3Client);
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

async function getSavedRides(query) {
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
        FROM Rides r LEFT JOIN LatestRideTimes lrt ON r.id=lrt.rideID`);
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
        var fpTimeStr = (rideTime.fastPassTime != null)? `"${rideTime.fastPassTime.format("HH:mm:ss")}"`: `null`;
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
    var existingRideTimes = await removeNonExistantRides(rideTimes, query);
    var nowStr = moment().tz(tz).format("YYYY-MM-DD HH:mm:ss");
    var rows = [];
    for (var rideTime of existingRideTimes) {
        var fpTimeStr = (rideTime.fastPassTime != null)? rideTime.fastPassTime.format("HH:mm:ss"): null;
        rows.push([rideTime.id, nowStr, rideTime.waitMins, fpTimeStr, rideTime.status]);
    }
    
    await query(`INSERT INTO RideTimes VALUES ?`, [rows]);
}

module.exports = {
    addRideInformations: addRideInformations,
    getSavedRides: getSavedRides,
    getUpdatedRideTimes: getUpdatedRideTimes,
    saveLatestRideTimes: saveLatestRideTimes,
    saveToHistoricalRideTimes: saveToHistoricalRideTimes
};