var rp = require('request-promise-native');
var moment = require('moment-timezone');
var cheerio = require('cheerio');
var he = require('he');
var passes = require('./Pass');
var util = require('util');

var PARK_NAMES = [ "disneyland", "disney-california-adventure" ];

var sleep = util.promisify((a, f) => setTimeout(f, a));


async function getAllSchedules(now, tz, reqDelay = 3000) {
    var body = await getSchedulesPage('');
    const $ = cheerio.load(body, {
        normalizeWhitespace: true,
        xmlMode: true
    });

    var getMonthlySchedulesPromises = [];
    $('#monthlyDate').children().each((idx, elmRef) => {
        var elm = $(elmRef);
        var dateStr = elm.attr("value");
        if (dateStr == null) {
            throw "No value in date";
        }
        var date = moment(dateStr, 'YYYY-MM-DD');
        getMonthlySchedulesPromises.push(getSchedulesForMonth(date));
    });
    var monthlySchedules = await Promise.all(getMonthlySchedulesPromises);

    //Assign blackout levels to each day
    var blackouts = await getBlackoutDates(now);
    monthlySchedules.forEach((monthlySchedule, monthI) => {
        for (var scheduleDay in monthlySchedule) {
            var schedule = monthlySchedule[scheduleDay];
            for (var parkName of PARK_NAMES) {
                var blockLevel = getDayBlockLevel(blackouts, parkName, monthI, scheduleDay);
                schedule[parkName]["blockLevel"] = blockLevel;
            }
        }
    });

    //Assign crowd levels to each day
    var crowdLevels = await getCrowdLevels();
    var dateTime = now.clone().startOf("month");

    for (var monthlySchedule of monthlySchedules) {
        for (var dayStr in monthlySchedule) {
            var day = parseInt(dayStr);
            dateTime.set('date', day);
            var dateStr = dateTime.format('YYYY-MM-DD');
            var crowdLevel = crowdLevels[dateStr];
            var daySchedule = monthlySchedule[dayStr];
            for (var parkName in daySchedule) {
                daySchedule[parkName]["crowdLevel"] = crowdLevel;
            }
        }
        dateTime.set(1, 'date');
        dateTime.add(1, 'months');
    }

    //Assign events to schedule
    var dt = now.clone();
    var events = await getEvents(now, tz, reqDelay);
    var lastMonth = dt.month();
    var monthI = 0;
    for (var dayEvents of events) {
        if (lastMonth != dt.month()) {
            monthI++;
        }
        lastMonth = dt.month();
        monthlySchedules[monthI][dt.date()]["events"] = dayEvents;
        dt.add(1, 'days');
    }

    return monthlySchedules;
}

async function getSchedulesForMonth(date) {
    var body = await getSchedulesPage(date.format('YYYY-MM-DD'));
    const $ = cheerio.load(body, {
        normalizeWhitespace: true,
        xmlMode: true
    });

    var schedules = {};
    var calendarTable = $('#monthlyCalendarTable');
    calendarTable.find('.dayOfMonth').each((idx, dayOfMonthElmRef) => {
        var dayOfMonthElm = $(dayOfMonthElmRef);
        if (dayOfMonthElm.hasClass('noData')) {
            return;
        }
        var dayOfMonth = parseInt(dayOfMonthElm.text());
        var dayElm = dayOfMonthElm.parent();
        
        schedules[dayOfMonth] = {};
        for (var parkName of PARK_NAMES) {
            var daySchedule = getScheduleForPark(dayElm, parkName, $);
            if (daySchedule != null) {
                schedules[dayOfMonth][parkName] = daySchedule;
            } else {
                schedules[dayOfMonth][parkName] = {};
            }
        }
    });
    return schedules;
}

async function getSchedulesPage(urlPostfix) {
    var options = {
        method: 'GET',
        uri: 'https://disneyland.disney.go.com/calendars/month/' + urlPostfix,
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    };
    var body = await rp(options);
    return body;
}

function getScheduleForPark(dayElm, parkName, $) {
    var parkElm = dayElm.find('.' + parkName);
    if (parkElm.length == 0) {
        return null;
    }
    var operatingHours = getParkOperatingHours(parkElm);
    var magicHours = getMagicHours(parkElm, $);

    return {
        operatingHours: operatingHours,
        magicHours: magicHours
    };
}

function getParkOperatingHours(parkElm) {
    var operatingHoursElms = parkElm.find('.parkHours');
    if (operatingHoursElms.length == 0) {
        throw "Park Schedules did not contain operating hours";
    }
    var parkHourElms = operatingHoursElms.children();
    if (parkHourElms.length == 0) {
        throw "Could not find park hours";
    }
    var parkHourText = parkHourElms.first().text().toLowerCase();
    return parseHourPair(he.decode(parkHourText));
}

function getMagicHours(parkElm, $) {
    var magicHourElms = parkElm.find('.magicHours');
    if (magicHourElms.length == 0) {
        return null;
    }
    var magicHourDiv = magicHourElms.first();
    if (magicHourDiv.children().length < 2) {
        return null;
    }
    var magicHourText = $(magicHourDiv.children().get(1)).text().toLowerCase();
    var magicHours = parseHourPair(he.decode(magicHourText));
    return magicHours;
}

function parseHourPair(timeRangeStr) {
    var amIdx = timeRangeStr.indexOf("am");
    var pmIdx = timeRangeStr.indexOf("pm");
    var idx = (amIdx < pmIdx) ? amIdx: pmIdx;
    if (amIdx < 0 && pmIdx < 0) {
        throw "Could not find am or pm in the timeRangeStr... was given: " + timeRangeStr;
    } else if (amIdx < 0) {
        idx = pmIdx;
    } else if (pmIdx < 0) {
        idx = amIdx;
    }
    idx += 3;
    if (idx >= timeRangeStr.length) {
        throw "No second time provided in the timeRangeStr... was given: " + timeRangeStr;
    }
    return {
        startTime: moment(timeRangeStr.substr(0, idx), "hh:mm A"),
        endTime: moment(timeRangeStr.substr(idx), "hh:mm A")
    }
}

async function getEvents(now, tz, reqDelay) {
    var dateTime = now.clone();
    var events = [];
    for (var i = 0; i < 30; i++) {
        events.push(await getEventsForDate(dateTime, tz));
        dateTime.add(1, 'days');
        await sleep(reqDelay * Math.random() * (2.0/3.0) + reqDelay / 3.0);
    }
    return events;
}

async function getEventsForDate(date, tz) {
    var options = {
        url: 'https://disneyland.disney.go.com/calendars/day/' + date.format('YYYY-MM-DD') + '/',
        method: 'GET',
        headers: {
            'x-requested-with': 'XMLHttpRequest'
        }
    };
    
    var body = await rp(options);
    const $ = cheerio.load(body, {
        normalizeWhitespace: true,
        xmlMode: true
    });

    var events = []; 
    $(".eventDetail").each((idx, cardRef) => {
        var cardElm = $(cardRef);
        var name = cardElm.find(".eventText").text();
        if (name != null && name.length > 0) {
            var imgUrl = cardElm.find('.thumbnail').prop('src');
            var location = cardElm.find(".locationNameContainer").text();
            var operatingHoursText = cardElm.find(".operatingHoursContainer").text();
            var operatingHoursSplit = operatingHoursText.split(',');
            var operatingTimes = [];
            for (var operatingHourStr of operatingHoursSplit) {
                var operatingHourTrimmed = operatingHourStr.trim();
                var operatingTime = moment(operatingHourTrimmed, "h:mm A").tz(tz);
                operatingTimes.push(operatingTime);
            }
            events.push({
                name: name,
                imgUrl: imgUrl,
                location: location,
                operatingTimes: operatingTimes
            });
        }
    });

    return events;
}

async function getBlackoutDates(now) {
    var options = {
        method: 'GET',
        uri: 'https://disneyland.disney.go.com/passes/blockout-dates/',
    };
    var body = await rp(options);
    const $ = cheerio.load(body, {
        normalizeWhitespace: true,
        xmlMode: true
    });

    var blackouts = {};
    $('li[data-type-pass]').each((idx, typeRef) => {
        var elm = $(typeRef);
        var passType = elm.attr('data-type-pass');
        var dlCalendar = elm.find('.park-calendar-dl');
        var disBlackoutDays = getParkBlackoutDays(dlCalendar, now, $);
        var caCalendar = elm.find('.park-calendar-dca');
        var caBlackoutDays = getParkBlackoutDays(caCalendar, now, $);
        blackouts[passType] = {
            "disneyland": disBlackoutDays,
            "disney-california-adventure": caBlackoutDays
        };
    });
    return blackouts;
}


function getParkBlackoutDays(calendarElm, now, $) {
    var monthBlackoutDays = [];

    var dateTime = now.clone().startOf("month");
    calendarElm.find('.calendarImageLabel').each((idx, monthRef) => {
        var dt = dateTime.clone();
        dateTime = dateTime.add(1, 'months');

        var monthElm = $(monthRef);
        var monthBlackoutText = monthElm.text().toLowerCase();
        if (monthBlackoutText.indexOf("no blockout") >= 0) {
            monthBlackoutDays.push({});
            return;
        }

        var monthIdx = -1; 
        for (var i = 0; i < 12; i++) {
            var monthName = dt.format("MMMM").toLowerCase();
            monthIdx = monthBlackoutText.indexOf(monthName);
            if (monthIdx >= 0) {
                for (var j = 0; j < i; j++) {
                    monthBlackoutDays.push({});
                }
                dateTime = dt.add(1, 'months');
                break;
            }
            dt.add(1, 'months');
        }
        if (monthIdx < 0) {
            console.warn("MONTH not found in text " + monthBlackoutText);
            return;
        }
        var blackoutDays = {};
        var daysText = monthBlackoutText.substr(monthIdx + monthName.length);
        var dayRanges = daysText.split(',');
        for (var dayRange of dayRanges) {
            var toIdx = dayRange.indexOf('to');
            if (toIdx >= 0) {
                var startDay = parseInt(dayRange.substr(0, toIdx).trim());
                var endDay = parseInt(dayRange.substr(toIdx + 2).trim());
                for (var day = startDay; day <= endDay; day++) {
                    blackoutDays[day] = true;
                }
            } else {
                var day = dayRange.trim();
                blackoutDays[day] = true;
            }
        }
        monthBlackoutDays.push(blackoutDays);
    });

    return monthBlackoutDays;
}


function getDayBlockLevel(blackouts, parkName, monthI, day) {
    var maxBlockLevel = -1;
    for (var passType in blackouts) {
        var blockLevel = passes.getBlockLevel(passType);
        if (maxBlockLevel > blockLevel) {
            continue;
        }
        var passBlackouts = blackouts[passType];
        var parkBlackouts = passBlackouts[parkName];
        if (monthI < parkBlackouts.length) {
            var monthlyBlackouts = parkBlackouts[monthI];
            if (monthlyBlackouts == null || monthlyBlackouts[day]) {
                maxBlockLevel = blockLevel;
            }
        }
    }
    return maxBlockLevel;
}

async function getCrowdLevels() {
    var eventIDToCrowdLevel = {
        "10074": 0,
        "10034": 1,
        "10071": 2,
        "10076": 3
    };

    var options = {
        method: 'GET',
        uri: 'http://www.isitpacked.com/',
        qs: {
            "rhc_action": "get_calendar_events",
            "calendar": "dl",
            "start": "0",
            "end": "1924992000"
        },
        json: true
    };
    var data = await rp(options);
    
    var dateToCrowdLevel = {};
    for (var evt of data["EVENTS"]) {
        var localID = evt["local_id"];
        var crowdLevel = eventIDToCrowdLevel[localID];
        if (crowdLevel != null) {
            var eventDatesStr = evt["fc_rdate"];
            var eventDates = eventDatesStr.split(',');
            for (var eventDateStr of eventDates) {
                var formatted = eventDateStr.substr(0, 4) + "-" + eventDateStr.substr(4, 2) + "-" + eventDateStr.substr(6, 2);
                dateToCrowdLevel[formatted] = crowdLevel;
            }
        }
    }
    return dateToCrowdLevel;
}

module.exports = {
    getAllSchedules: getAllSchedules,
    getSchedulesForMonth: getSchedulesForMonth,
    getCrowdLevels: getCrowdLevels,
    getBlackoutDates: getBlackoutDates,
    getEvents: getEvents,
    getEventsForDate: getEventsForDate,
    PARK_NAMES: PARK_NAMES
};