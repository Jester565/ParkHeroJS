var rp = require('request-promise-native');
const util = require('util');
const fs = require('fs');
const readFileAsync = util.promisify(fs.readFile);
const moment = require('moment-timezone');

var schedules = require('../dis/Schedule');

jest.mock('request-promise-native');

test('monthly schedules', async () => {
    var respText = await readFileAsync(__dirname + "/ScheduleResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(respText);
    }));
    var schedule = await schedules.getSchedulesForMonth(moment('2019-03-01', 'YYYY-MM-DD'));
    expect(Object.keys(schedule).length).toBe(19);
    var firstDaySchedule = schedule["1"];
    expect(firstDaySchedule["disneyland"]["operatingHours"]["startTime"].format("HH:mm")).toBe("08:00");
    expect(firstDaySchedule["disneyland"]["operatingHours"]["endTime"].format("HH:mm")).toBe("00:00");
    expect(firstDaySchedule["disney-california-adventure"]["operatingHours"]["startTime"].format("HH:mm")).toBe("08:00");
    expect(firstDaySchedule["disney-california-adventure"]["operatingHours"]["endTime"].format("HH:mm")).toBe("22:00");
    expect(firstDaySchedule["disney-california-adventure"]["magicHours"]["startTime"].format("HH:mm")).toBe("07:00");
    expect(firstDaySchedule["disney-california-adventure"]["magicHours"]["endTime"].format("HH:mm")).toBe("08:00");
});

test('blackouts', async () => {
    var respText = await readFileAsync(__dirname + "/BlackoutResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(respText);
    }));
    var now = moment("2019-02-05 13:00", "YYYY-MM-DD HH:mm");
    var blackouts = await schedules.getBlackoutDates(now);
    expect(Object.keys(blackouts).length).toBe(5);
    var febBlackoutDays = Object.keys(blackouts["socal-select-annual"]["disneyland"][0]);
    febBlackoutDays.sort((e1, e2) => {
        var ei1 = parseInt(e1);
        var ei2 = parseInt(e2);
        return ei1 - ei2;
    });
    expect(febBlackoutDays).toEqual(["2", "3", "9", "10", "15", "16", "17", "18", "23", "24"]);
});

test('crowdlevels', async () => {
    var respText = await readFileAsync(__dirname + "/CrowdResp.json", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(JSON.parse(respText));
    }));
    
    var crowdLevels = await schedules.getCrowdLevels();
    expect(crowdLevels["2019-02-05"]).toBe(0);
});

test('daily events', async () => {
    var respText = await readFileAsync(__dirname + "/EventResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(respText);
    }));

    var events = await schedules.getEventsForDate(moment("2019-02-07", "YYYY-MM-DD"), "America/Los_Angeles");
    expect(events.length).toBe(34);
    var laughingStockEvent = events.find((e) => {
        return (e.name == "The Laughing Stock Co.");
    });
    expect(laughingStockEvent.imgUrl).toBeTruthy();
    expect(laughingStockEvent.location).toBe("Frontierland"),
    expect(laughingStockEvent.operatingTimes.length).toBe(6);
    expect(laughingStockEvent.operatingTimes[1].format("HH:mm")).toBe("13:00");
});

test('all schedules', async () => {
    var febCalendarResp = await readFileAsync(__dirname + "/CalendarResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(febCalendarResp);
    }));

    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(febCalendarResp);
    }));

    var marchCalendarResp = await readFileAsync(__dirname + "/ScheduleResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(marchCalendarResp);
    }));

    var blackoutResp = await readFileAsync(__dirname + "/BlackoutResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(blackoutResp);
    }));

    var crowdResp = await readFileAsync(__dirname + "/CrowdResp.json", {encoding: 'utf8'});
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(JSON.parse(crowdResp));
    }));

    var eventResp = await readFileAsync(__dirname + "/EventResp.xml", {encoding: 'utf8'});
    rp.mockResolvedValue(new Promise((resolve) => {
        resolve(eventResp);
    }));
    var now = moment("2019-02-06", "YYYY-MM-DD");
    var allSchedules = await schedules.getAllSchedules(now, "America/Los_Angeles", 0);
    expect(allSchedules.length).toBe(2);
    expect(Object.keys(allSchedules[0]).length).toBe(23);
    expect(Object.keys(allSchedules[1]).length).toBe(19);
    var dt = now.clone();
    var lastMonth = dt.month();
    var monthI = 0;
    for (var i = 0; i < 30; i++) {
        if (lastMonth != dt.month()) {
            monthI++;
        }
        lastMonth = dt.month();
        var daySchedule = allSchedules[monthI][dt.date()];
        expect(daySchedule["events"].length).toBeGreaterThan(0);
        var parkNames = ["disneyland", "disney-california-adventure"];
        for (var parkName of parkNames) {
            expect(daySchedule[parkName]["blockLevel"] !== null).toBeTruthy();
            expect(daySchedule[parkName]["crowdLevel"] !== null).toBeTruthy();
        }
        dt.add(1, 'days');
    }
});