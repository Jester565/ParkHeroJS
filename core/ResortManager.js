var schedules = require('../dis/Schedule');
var weathers = require('./Weather');
var moment = require('moment-timezone');
var request = require('request');
var imgUploader = require('./ImageUploader');

String.prototype.hashCode = function() {
  var hash = 0, i, chr;
  if (this.length === 0) return hash;
  for (i = 0; i < this.length; i++) {
    chr   = this.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

/*
    parkInfo: {
        operatingHours: {
            startTime,
            endTime
        }
        magicHours: {
            starTime,
            endTime
        },
        crowdLevel,
        blockLevel
    }
*/
async function addParkSchedule(date, parkID, parkInfo, query) {
    var openTime = (parkInfo.operatingHours != null)? parkInfo.operatingHours.startTime.format("HH:mm:ss"): null;
    var closeTime = (parkInfo.operatingHours != null)? parkInfo.operatingHours.endTime.format("HH:mm:ss"): null;
    var magicStartTime = (parkInfo.magicHours != null)? parkInfo.magicHours.startTime.format("HH:mm:ss"): null;
    var magicEndTime = (parkInfo.magicHours != null)? parkInfo.magicHours.endTime.format("HH:mm:ss"): null;
    await query(`INSERT INTO ParkSchedules VALUES ?
        ON DUPLICATE KEY UPDATE openTime=?, closeTime=?,
        magicHourStartTime=?, magicHourEndTime=?,
        crowdLevel=?, blockLevel=?`, 
        [[[date.format("YYYY-MM-DD"), 
            parkID,
            openTime,
            closeTime,
            magicStartTime,
            magicEndTime,
            parkInfo.crowdLevel,
            parkInfo.blockLevel]],
        openTime, 
        closeTime, 
        magicStartTime, 
        magicEndTime, 
        parkInfo.crowdLevel, 
        parkInfo.blockLevel]);
}

async function addEvent(date, resortID, event, imgSizes, bucket, query, s3Client) {
    var savedEventImgUrls = await query(`SELECT imgUrl FROM Events WHERE id=?`, [event.id]);
    var imgKey = null;
    if (savedEventImgUrls.length == 0) {
        imgKey = 'eventPics/' + event.id;
        console.log("IMGURL: ", event.imgUrl);
        var readStream = request.get(event.imgUrl);
        await imgUploader.uploadImageStreamOfSizes(readStream, 
            imgSizes, 
            bucket,
            imgKey,
            s3Client,
            true);
    } else {
        imgKey = savedEventImgUrls[0].imgUrl;
    }
    await query(`INSERT INTO Events VALUES ?
        ON DUPLICATE KEY UPDATE name=?, resortID=?, imgUrl=?, location=?`, 
        [[[event.id, event.name, resortID, imgKey, event.location]],
        event.name, resortID, imgKey, event.location]);
    var rows = [];
    for (var eventTime of event.operatingTimes) {
        rows.push([event.id, date.format("YYYY-MM-DD") + " " + eventTime.format("HH:mm:ss")]);    
    }
    await query(`INSERT IGNORE INTO EventTimes VALUES ?`,
            [rows]);
}

async function addSchedules(resortID, now, tz, imgSizes, bucket, query, s3Client) {
    var parkNamesToID = {};
    var parks = await getParks(resortID, query);
    for (var park of parks) {
        parkNamesToID[park["urlName"]] = park["id"];
    }
    
    var resortSchedule = await schedules.getAllSchedules(now, imgSizes[imgSizes.length - 1], tz);
    //Assign events to schedule
    var dt = now.clone();
    var lastMonth = dt.month();
    var monthI = 0;
    while (true) {
        if (lastMonth != dt.month()) {
            monthI++;
        }
        lastMonth = dt.month();
        if (monthI >= resortSchedule.length) {
            break;
        }
        var daySchedule = resortSchedule[monthI][dt.date()];
        if (daySchedule == null) {
            break;
        }
        for (var parkName in parkNamesToID) {
            var parkInfo = daySchedule[parkName];
            var parkID = parkNamesToID[parkName];
            await addParkSchedule(dt, parkID, parkInfo, query);
        }
        if (daySchedule.events != null) {
            for (var event of daySchedule.events) {
                await addEvent(dt, resortID, event, imgSizes, bucket, query, s3Client);
            }
        }

        dt.add(1, 'days');
    }
}

async function addForecast(resortID, forecast, query) {
    await query(`INSERT INTO HourlyWeather VALUES ?
        ON DUPLICATE KEY UPDATE rainStatus=?, feelsLikeF=?`,
        [[[resortID, 
            forecast.dateTime.format("YYYY-MM-DD HH:mm:ss"), 
            forecast.rainStatus,
            forecast.feelsLikeF]],
        forecast.rainStatus,
        forecast.feelsLikeF]);
}

async function addForecasts(darkskySecret, resortID, query) {
    var resortInfo = await getResortInfo(resortID, query);
    var forecasts = await weathers.getForecast(
        darkskySecret, 
        resortInfo.longitude, 
        resortInfo.latitude,
        resortInfo.timezone);
    for (var forecast of forecasts) {
        await addForecast(resortID, forecast, query);
    }
}

async function getResortTimezone(resortID, query) {
    var tzResult = await query(`SELECT timezone FROM Resorts WHERE id=?`, resortID);
    if (tzResult.length == 0) {
        return null;
    }
    return tzResult[0].timezone;
}

async function getResortInfo(resortID, query) {
    var resortInfos = await query(`SELECT id, name, zipcode, longitude, latitude, timezone FROM Resorts WHERE id=?`, resortID);
    return resortInfos[0];
}

async function getParks(resortID, query) {
    var parks = await query(`SELECT id, name, urlName, iconUrl FROM Parks WHERE resortID=?`, [resortID]);
    return parks;
}

async function getSchedules(resortID, startDate, query) {
    var schedules = await query(`SELECT p.name AS parkName, p.iconUrl AS parkIconUrl, ps.openTime AS openTime, ps.closeTime AS closeTime,
        ps.magicHourStartTime AS magicStartTime, ps.magicHourEndTime AS magicEndTime, ps.crowdLevel AS crowdLevel,
        ps.blockLevel AS blockLevel, DATE_FORMAT(ps.date, "%Y-%m-%d") AS date
        FROM ParkSchedules ps 
        INNER JOIN Parks p ON ps.parkID=p.id
        WHERE ps.date>=DATE(?) AND p.resortID=?
        ORDER BY ps.date, p.id`,
        [startDate.format("YYYY-MM-DD"), resortID]);
    return schedules;
}

async function getEvents(resortID, date, userID, tz, query) {
    var dbEvents = await query(`SELECT e.id AS id, e.name AS officialName, e.location AS land, e.imgUrl AS officialPicUrl, et.dateTime AS dateTime
        FROM Events e INNER JOIN EventTimes et ON e.id=et.eventID WHERE e.resortID=? AND DATE(et.dateTime)=? ORDER BY e.id, et.dateTime`, [resortID, date.format("YYYY-MM-DD")]);
    var lastDbEvent = null;
    var events = [];
    var dateTimes = [];
    var addEvent = () => {
        events.push({
            id: lastDbEvent.id,
            info: {
                officialName: lastDbEvent.officialName,
                land: lastDbEvent.land,
                officialPicUrl: lastDbEvent.officialPicUrl
            },
            dateTimes: dateTimes
        });
    };
    for (var dbEvent of dbEvents) {
        if (lastDbEvent != null && dbEvent.id != lastDbEvent.id) {
            addEvent();
            dateTimes = [];
        }
        lastDbEvent = dbEvent;
        var dateTimeTzStr = moment(dbEvent.dateTime).tz(tz, true).format("YYYY-MM-DD HH:mm:ss");
        console.log("DATETIME: ", dbEvent.dateTime, "TZ: ", dateTimeTzStr);
        dateTimes.push(dateTimeTzStr);
    }
    if (lastDbEvent != null) {
        addEvent();
    }
    return events;
}

async function getHourlyWeather(resortID, date, query) {
    var weathers = await query(`SELECT feelsLikeF, rainStatus, dateTime FROM HourlyWeather
        WHERE resortID=? AND DATE(dateTime)=? ORDER BY dateTime`, [resortID, date.format("YYYY-MM-DD")]);
    
    return weathers;
}

module.exports = {
    addSchedules: addSchedules,
    addForecasts: addForecasts,
    getSchedules: getSchedules,
    getResortTimezone: getResortTimezone,
    getResortInfo: getResortInfo,
    getParks: getParks,
    getHourlyWeather: getHourlyWeather,
    getEvents: getEvents
};