/*
    CREATE TABLE PlannedFpTransactions(id varchar(100), userID varchar(50), rideID int(11), date DATE, partyID varchar(200), PRIMARY KEY(id), FOREIGN KEY (userID) REFERENCES Users(id), FOREIGN KEY (rideID) REFERENCES Rides(id), FOREIGN KEY (partyID) REFERENCES Parties(id));
    CREATE TABLE FpTransactionPasses(transactionID varchar(100), userID varchar(50), passID varchar(200), priority INT, PRIMARY KEY(transactionID, passID), FOREIGN KEY(transactionID) REFERENCES PlannedFpTransactions(id), FOREIGN KEY (passID, userID) REFERENCES ParkPasses(id, ownerID));
*/
var moment = require('moment-timezone');
var uuidv4 = require('uuid/v4');

//New FastPassManager relies less on the database
var passes = require('../dis/Pass');
var passManager = require('./PassManager');
var predictionManager = require('./Predictions');
var resortManager = require('./ResortManager');
var rideManager = require('./RideManager');

function getLatestSelectionTime(selectionTimes, tz) {
    var latestSelectionTime = moment().tz(tz);
    for (var selectionTime of selectionTimes) {
        if (selectionTime > latestSelectionTime) {
            latestSelectionTime = selectionTime;
        }
    }
    return latestSelectionTime;
}

function getNextSelectionTime(hasMaxPass, latestSelectionTime, fpTime) {
    var maxSelectionWaitMins = 120;
    if (hasMaxPass) {
        maxSelectionWaitMins = 90;
    }
    var nextSelectionTime = null;
    if (fpTime != null) {
        var minsToFastPass = moment.duration(fpTime.diff(latestSelectionTime)).asMinutes();
        if (minsToFastPass <= maxSelectionWaitMins) {
            nextSelectionTime = fpTime.clone();
        }
    }
    if (nextSelectionTime == null) {
        nextSelectionTime = latestSelectionTime.clone().add(maxSelectionWaitMins, 'minutes');
    }
    return nextSelectionTime;
}

//I apologize for all those parameters, I would inline this but its recursive
async function processPlannedTransaction(transactionID, passID, priority, 
    transactions, passToTransactionIDs, nextSelectionTimes, 
    passes, tz, query) 
{
    var transaction = transactions[transactionID];
    if (transaction.passesToPriorities[passID] != null) {
        return;
    }
    transaction.passesToPriorities[passID] = priority;
    if (transaction.passCount == Object.keys(transaction.passesToPriorities).length) {
        var transactionSelectionTimes = [];
        for (var passID in transaction.passesToPriorities) {
            if (nextSelectionTimes[passID] != null) {
                transactionSelectionTimes.push(nextSelectionTimes[passID]);
            }
        }
        transaction.selectionDateTime = getLatestSelectionTime(transactionSelectionTimes, tz);
        transaction.fastPassTime = await rideManager.getPredictedFastPassTime(transaction.rideID, transaction.selectionDateTime, tz, query);
        transaction.passesToNextSelectionTime = {};
        for (var passID in transaction.passesToPriorities) {
            var pass = passes[passID];
            var nextSelectionTime = getNextSelectionTime(pass.hasMaxPass, transaction.selectionDateTime, transaction.fastPassTime);
            nextSelectionTimes[passID] = nextSelectionTime;
            transaction.passesToNextSelectionTime[passID] = nextSelectionTime;
            var passPriority = transaction.passesToPriorities[passID];
            var nextTransactionID = passToTransactionIDs[passID][passPriority + 1];
            if (nextTransactionID != null) {
                await processPlannedTransaction(nextTransactionID, passID, passPriority + 1, 
                    transactions, passToTransactionIDs, nextSelectionTimes, passes, tz, query);
            }
        }
    }
}


/*
    passes: [
        passID: {
            selectionTime,
            hasMaxPass
        }
    ]
*/
async function getPlannedTransactions(userIDs, passes, parkDate, tz, query) {
    var transactionPasses = await query(`SELECT tp.transactionID AS transactionID, t.rideID AS rideID, p.id AS passID, p.ownerID AS userID, tp.priority
        FROM FpTransactionPasses tp 
        INNER JOIN PlannedFpTransactions t ON tp.transactionID=t.id
        INNER JOIN ParkPasses p ON tp.passID=p.id AND tp.userID=p.ownerID
        WHERE p.isEnabled=1 AND t.date=? AND tp.userID IN (?) ORDER BY tp.priority`, [parkDate.format("YYYY-MM=DD"), userIDs]);
    
    //{ rideID, passCount, passesToPriorities: <passID, priority>, selectionTime, fpTime }
    var transactions = { };
    //Map <passID, <priority, transactionIDs>>: Used so we can figure out what the next transactionID is for a particular pass
    var passToTransactionIDs = { };

    //Build passToTransactionIDs and transactions to count how many passes a particular transaction is expecting before processing
    for (var tp of transactionPasses) {
        if (passToTransactionIDs[tp.passID] == null) {
            passToTransactionIDs[tp.passID] = {};
        }
        passToTransactionIDs[tp.passID][tp.priority] = tp.transactionID;
        if (transactions[tp.transactionID] == null) {
            transactions[tp.transactionID] = { 
                rideID: tp.rideID, 
                passCount: 0, 
                passesToPriorities: { },
                selectionDateTime: null,
                fastPassTime: null
            };
        }
        transactions[tp.transactionID].passCount += 1;
    }
    
    //Keep track of what time the passes next selection can be made
    var nextSelectionTimes = {};
    for (var passID in passes) {
        var pass = passes[passID];
        nextSelectionTimes[passID] = pass.selectionTime;
    }

    //Kick off by processing the first transaction for every pass, the recursion should handle the rest
    for (var tp of transactionPasses) {
        await processPlannedTransaction(tp.transactionID, tp.passID, tp.priority,
            transactions, passToTransactionIDs, nextSelectionTimes,
            passes, tz, query);
        if (tp.priority > 0) {
            break;
        }
    }
    var results = [];
    for (var transactionID in transactions) {
        var transaction = transactions[transactionID];
        var passResults = [];
        for (var passID in transaction.passesToPriorities) {
            var priority = transaction.passesToPriorities[passID];
            var nextSelectionTime = transaction.passesToNextSelectionTime[passID];
            passResults.push({
                id: passID,
                priority: priority,
                nextSelectionDateTime: nextSelectionTime
            });
        }
        results.push({
            id: transactionID,
            rideID: transaction.rideID,
            selectionDateTime: transaction.selectionDateTime,
            fastPassTime: transaction.fastPassTime,
            passes: passResults
        });
    }

    return results;
}

/*
    plannedTransactions: [{
        id (optional),
        rideID,
        passes: [{
            id,
            priority
        }]
    }]
*/
async function updatePlannedTransactions(plannedTransactions, userIDs, parkDate, tz, query) {
    console.log("PLANNED TRANASCATIONS: ", JSON.stringify(plannedTransactions, null, 2));
    console.log("USERIDS: ", JSON.stringify(userIDs));
    //<passID, <priority, transactionID>>
    var passIDsToTransactionIDs = {};
    for (var transaction of plannedTransactions) {
        //If id is not given, make our own
        if (transaction.id == null) {
            transaction.id = uuidv4();
        }

        for (var pass of transaction.passes) {
            var prioritiesToTransactionID = passIDsToTransactionIDs[pass.id];
            if (prioritiesToTransactionID == null) {
                prioritiesToTransactionID = {};
                passIDsToTransactionIDs[pass.id] = prioritiesToTransactionID;
            }
            if (prioritiesToTransactionID[pass.priority] != null) {
                throw "Pass " + pass.id + " had duplicate priority for " + pass.priority;
            }
            prioritiesToTransactionID[pass.priority] = transaction.id;
        }
    }
    //Verify that priorities are no more than one apart
    for (var passID in passIDsToTransactionIDs) {
        var prioritiesToTransactionID = passIDsToTransactionIDs[passID];
        var priorityCount = Object.keys(prioritiesToTransactionID).length;
        for (var priorityStr in prioritiesToTransactionID) {
            var priority = parseInt(priorityStr);
            if (priority < 0 || priority >= priorityCount) {
                throw "Priority was more than one apart";
            }
        }
    }
    //Verify all passes for plans belong to users
    var userPassesArr = await passManager.getPassesForUsers(userIDs, true, tz, query);
    var userPassIDs = {};
    for (var userPasses of userPassesArr) {
        for (var pass of userPasses.passes) {
            userPassIDs[pass.id] = userPasses.user.id;
        }
    }
    for (var passID in passIDsToTransactionIDs) {
        if (userPassIDs[passID] == null) {
            throw "PassID: " + passID + " does not belong to users";
        }
    }
    console.log("DELETING PASSES FOR: ", JSON.stringify(Object.keys(userPassIDs)));
    //Delete all previous transactions for passes in party
    await query(`DELETE FROM FpTransactionPasses WHERE passID IN (?)`, [Object.keys(userPassIDs)]);
    await query(`DELETE pfpt FROM PlannedFpTransactions  pfpt
        LEFT JOIN FpTransactionPasses ftp ON ftp.transactionID=pfpt.id 
        WHERE ftp.transactionID IS NULL`);

    //Insert all the new transactions and transactionPasses
    var insertTransactionPromises = [];
    for (var transaction of plannedTransactions) {
        insertTransactionPromises.push(
            query(`INSERT INTO PlannedFpTransactions VALUES ?`, [[[transaction.id, transaction.rideID, parkDate.format("YYYY-MM-DD HH:mm:ss")]]])
        );
    }
    await Promise.all(insertTransactionPromises);

    var insertFpPassPromises = [];
    for (var passID in passIDsToTransactionIDs) {
        var userID = userPassIDs[passID];
        var prioritiesToTransactionID = passIDsToTransactionIDs[passID];
        for (var priorityStr in prioritiesToTransactionID) {
            var transactionID = prioritiesToTransactionID[priorityStr];
            var priority = parseInt(priorityStr);
            insertFpPassPromises.push(
                query(`INSERT INTO FpTransactionPasses VALUES ?`, [[[transactionID, userID, passID, priority]]])
            );
        }
    }
    await Promise.all(insertFpPassPromises);
}

async function getResortCloseDateTime(resortID, date, tz, query) {
    var dateStr = date.format("YYYY-MM-DD");
    var parkCloseTimes = await query(`SELECT ps.closeTime AS closeTime FROM ParkSchedules ps
        INNER JOIN Parks p ON ps.parkID=p.id WHERE p.resortID=? AND ps.date=?`, [resortID, dateStr]);
    var maxDateTime = null;
    for (var parkCloseTime of parkCloseTimes) {
        var parkCloseDateTime = moment(`${dateStr} ${parkCloseTime}`, "YYYY-MM-DD HH:mm:ss").tz(tz, true);
        if (parkCloseDateTime.hours() < 4) {
            parkCloseDateTime.add(1, 'days');
        }
        if (maxDateTime == null || parkCloseDateTime > maxDateTime) {
            maxDateTime = parkCloseDateTime;
        }
    }
    return maxDateTime;
}

/*
    Response: {
        transactions: [{
            rideID,
            startDateTime,
            endDateTime,
            passes: [{
                id,
                startDateTime,
                endDateTime
            }]
        }],
        plannedTransactions: [{
            rideID,
            selectionTime,
            fastPassTime,
            passes: [{
                id,
                priority,
                nextSelectionDateTime
            }]
        }],
        allUserPasses: [
            {
                user: {
                    id,
                    profilePicUrl,
                    name
                }
                allPasses: [
                    {
                        pass: {
                            passID,
                            name,
                            expirationDT,
                            type
                        }
                        fastPassInfo: {
                            selectionDateTime,
                            earliestSelectionDateTime
                        ]
                    }
                ]
            }
        ]
    }
*/
async function getFastPasses(resortID, userIDs, accessToken, parkDate, tz, query) {
    var userPassesArr = await passManager.getPassesForUsers(userIDs, false, tz, query);

    var passIDsToUserPass = {};
    //Extract passes from user mapping
    var passAndDisIDs = [];
    for (var userPasses of userPassesArr) {
        for (var pass of userPasses.passes) {
            passIDsToUserPass[pass.id] = { "user": userPasses.user, "pass": pass };
            passAndDisIDs.push({
                passID: pass.id,
                disID: pass.disID
            });
        }
    }
    var fastPassData = await passes.aggregateFastPassesForPassIDs(passAndDisIDs, accessToken, tz);

    //Used in getPlannedTransactions <passID, {selectionTime, maxPass}> 
    var passIDsToInfo = {};
    //Make new userPasses that includes the fastPasses for each pass
    var userIDsToAllUserPasses = {};
    for (var fpResp of fastPassData.individualResps) {
        var userPass = passIDsToUserPass[fpResp.passID];
        passIDsToInfo[fpResp.passID] = {
            selectionTime: fpResp.earliestSelectionDateTime,
            latestSelectionTime: fpResp.selectionDateTime,
            hasMaxPass: passIDsToUserPass[fpResp.passID].pass.hasMaxPass
        };
        var allUserPasses = userIDsToAllUserPasses[userPass.user.id];
        if (allUserPasses == null) {
            allUserPasses = {
                user: userPass.user,
                allPasses: []
            };
            userIDsToAllUserPasses[userPass.user.id] = allUserPasses;
        }
        var passFastPasses = {
            pass: userPass.pass,
            fastPassInfo: {
                selectionDateTime: fpResp.selectionDateTime,
                earliestSelectionDateTime: fpResp.earliestSelectionDateTime
            }
        };
        allUserPasses.allPasses.push(passFastPasses);
    }
    var dbUpdatePromises = [];
    for (var passID in passIDsToInfo) {
        var passInfo = passIDsToInfo[passID];
        dbUpdatePromises.push(query(`INSERT INTO PassSelectionTimes VALUES ?
            ON DUPLICATE KEY UPDATE selectionTime=?, earliestSelectionTime=?`, 
                [[[passID, (passInfo.latestSelectionTime != null)? passInfo.latestSelectionTime.format("YYYY-MM-DD HH:mm:ss"): null, (passInfo.selectionTime != null)? passInfo.selectionTime.format("YYYY-MM-DD HH:mm:ss"): null]], 
                (passInfo.latestSelectionTime != null)? passInfo.latestSelectionTime.format("YYYY-MM-DD HH:mm:ss"): null, (passInfo.selectionTime)? passInfo.selectionTime.format("YYYY-MM-DD HH:mm:ss"): null]));
    }

    var plannedTransactions = await getPlannedTransactions(userIDs, passIDsToInfo, parkDate, tz, query);
    
    //If no endDateTime, then it is the end of the operating date
    for (var transaction of fastPassData.transactions) {
        if (transaction.endDateTime == null) {
            var closeDateTime = await getResortCloseDateTime(resortID, parkDate, tz, query);
            transaction.endDateTime = (closeDateTime != null)? closeDateTime: null;
        }
    }
    var allUserPasses = [];
    for (var userID in userIDsToAllUserPasses) {
        allUserPasses.push(userIDsToAllUserPasses[userID]);
    }
    
    for (var transaction of fastPassData.transactions) {
        transaction.startDateTime = (transaction.startDateTime)? transaction.startDateTime.format("YYYY-MM-DD HH:mm:ss"): null;
        transaction.endDateTime = (transaction.endDateTime)? transaction.endDateTime.format("YYYY-MM-DD HH:mm:ss"): null;
        for (var tranPass of transaction.passes) {
            tranPass.startDateTime = (tranPass.startDateTime)? tranPass.startDateTime.format("YYYY-MM-DD HH:mm:ss"): transaction.startDateTime;
            tranPass.endDateTime = (tranPass.endDateTime)? tranPass.endDateTime.format("YYYY-MM-DD HH:mm:ss"): transaction.endDateTime;
        }
    }
    var passIDsToMaxPriority = {};
    var passIDsToEarliestSelectionDateTimes = [];
    for (var plannedTransaction of plannedTransactions) {
        plannedTransaction.selectionDateTime = (plannedTransaction.selectionDateTime)? plannedTransaction.selectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null;
        plannedTransaction.fastPassTime = (plannedTransaction.fastPassTime)? plannedTransaction.fastPassTime.format("YYYY-MM-DD HH:mm:ss"): null;
        for (var ptPass of plannedTransaction.passes) {
            ptPass.nextSelectionDateTime = (ptPass.nextSelectionDateTime)? ptPass.nextSelectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null;
            passIDsToMaxPriority[ptPass.id] = (passIDsToMaxPriority[ptPass.id] == null || passIDsToMaxPriority[ptPass.id] < ptPass.priority)? ptPass.priority: passIDsToMaxPriority[ptPass.id];
            if (passIDsToEarliestSelectionDateTimes[ptPass.id] == null) {
                passIDsToEarliestSelectionDateTimes[ptPass.id] = [];
            }
            passIDsToEarliestSelectionDateTimes[ptPass.id].push(ptPass.nextSelectionDateTime);
        }
    }
    for (var allUserPassArr of allUserPasses) {
        for (var allPass of allUserPassArr.allPasses) {
            allPass.fastPassInfo.selectionDateTime = (allPass.fastPassInfo != null && allPass.fastPassInfo.selectionDateTime != null)? allPass.fastPassInfo.selectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null;
            allPass.fastPassInfo.earliestSelectionDateTime = (allPass.fastPassInfo != null && allPass.fastPassInfo.earliestSelectionDateTime)? allPass.fastPassInfo.earliestSelectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null;
            allPass.fastPassInfo.priority = passIDsToMaxPriority[allPass.pass.id];
            var earliestSelectionDateTimes = (passIDsToEarliestSelectionDateTimes[allPass.pass.id] != null)? passIDsToEarliestSelectionDateTimes[allPass.pass.id]: [];
            earliestSelectionDateTimes.unshift(allPass.fastPassInfo.earliestSelectionDateTime);
            allPass.fastPassInfo.earliestSelectionDateTimes = earliestSelectionDateTimes;
        }
    }
    await Promise.all(dbUpdatePromises);
    
    var result = {
        transactions: fastPassData.transactions,
        plannedTransactions: plannedTransactions,
        allUserPasses: allUserPasses
    };
    return result;
}

async function deleteInvalidPlannedFastPasses(query) {
    var transactionPasses = await query(`SELECT t.transactionID, ftp.passID, ftp.priority
        FROM PlannedFpTransactions t
        INNER JOIN FpTransactionPasses ftp ON t.id=ftp.transactionID
        INNER JOIN LatestRideTimes lrt ON t.rideID=lrt.rideID
        WHERE lrt.fastPassTime IS NULL
        ORDER BY ftp.priority DESC`);
    var transactionIDs = {};
    for (var transactionPass of transactionPasses) {
        transactionIDs[transactionPass.id] = true;
        await query(`UPDATE FpTransactionPasses SET priority=priority-1
        WHERE priority > ? AND passID=?`, 
        [transactionPass.priority, transactionPass.passID]);
    }
    await query(`DELETE FROM PlannedFpTransactions WHERE id IN (?)`, [Object.keys(transactionIDs)]);
}

async function pollSelectionUpdates(parkDate, now, lastCheckDateTime, query) {
    var updates = {};
    var passes = await query(`SELECT p.id AS passID, p.ownerID AS ownerID,
        (MAX(pst.earliestSelectionTime) < MAX(pst.selectionTime)) AS isEarliest 
        FROM ParkPasses p
        LEFT JOIN PassSelectionTimes pst ON pst.passID=p.id
        LEFT JOIN FpTransactionPasses ftp ON ftp.passID=p.id AND ftp.userID=p.ownerID
        LEFT JOIN PlannedFpTransactions t ON t.id=ftp.transactionID
        GROUP BY p.id, p.ownerID
        HAVING (MAX(t.date) IS NULL OR MAX(t.date) < ?) 
        AND MAX(pst.earliestSelectionTime) <= ? AND MAX(pst.earliestSelectionTime) > ?`,
        [parkDate.format("YYYY-MM-DD"), now.format("YYYY-MM-DD HH:mm:ss"), lastCheckDateTime.format("YYYY-MM-DD HH:mm:ss")]);
    for (var pass of passes) {
        if (updates[pass.ownerID] == null) {
            updates[pass.ownerID] = [];
        }
        updates[pass.ownerID].push({
            passID: pass.passID,
            isEarliest: pass.isEarliest
        });
    }
    return updates;
}

async function getActiveTransactions(now, parkDate, tz, query) {
    var transactionPasses = await query(`SELECT 
        t.id AS transactionID, 
        r.id AS rideID, 
        r.parkID AS parkID,
        fp.priority AS priority, fp.userID AS userID,
        p.id AS passID, p.disID AS disID, 
        pst.earliestSelectionTime AS selectionDateTime
        FROM PlannedFpTransactions t
        INNER JOIN Rides r ON t.rideID=r.id
        INNER JOIN FpTransactionPasses fp ON t.id=fp.transactionID
        INNER JOIN ParkPasses p ON fp.passID=p.id
        LEFT JOIN PassSelectionTimes pst ON fp.passID=pst.passID
        WHERE t.date=?
        ORDER BY t.id, fp.priority DESC`, [parkDate.format("YYYY-MM-DD")]);
    
    var transactions = [];
    var transaction = null;
    var transactionID = null;
    for (var transactionPass of transactionPasses) {
        if (transactionID != transactionPass.transactionID) {
            if (transaction != null) {
                transactions.push(transaction);
            }
            transaction = {
                id: transactionPass.transactionID,
                rideID: transactionPass.rideID,
                parkID: transactionPass.parkID,
                passes: {}
            };
            transactionID = transactionPass.transactionID;
        }
        if (transaction != null) {
            if (transactionPass.priority == 0 && (transactionPass.selectionDateTime == null || moment(transactionPass.selectionDateTime).tz(tz, true) <= now)) {
                transaction.passes[transactionPass.passID] = {
                    "passID": transactionPass.passID,
                    "disID": transactionPass.disID,
                    "userID": transactionPass.userID
                };
            } else {
                transaction = null;
            }
        }
    }
    if (transaction != null) {
        transactions.push(transaction);
    }
    return transactions;
}

//Consider calling this until updates is empty
async function pollMaxPassOrders(transactions, resortID, accessToken, parkDate, tz, query) {
    var parkDateStr = parkDate.format("YYYY-MM-DD");
    var parkCloseTimes = await query(`SELECT ps.parkID AS parkID, ps.closeTime AS closeTime FROM ParkSchedules ps
        INNER JOIN Parks p ON ps.parkID=p.id WHERE p.resortID=? AND ps.date=?`, [resortID, parkDateStr]);
    var parkSchedules = {};
    for (var parkClose of parkCloseTimes) {
        parkSchedules[parkClose.parkID] = {
            closeDateTime: moment(parkDateStr + " " + parkClose.closeTime, "YYYY-MM-DD HH:mm:ss")
        };
    }

    
    var orderPromises = [];
    for (var transaction of transactions) {
        var passIDs = Object.keys(transaction.passes);
        var disID = transaction.passes[passIDs[0]].disID;
        var parkCloseDateTime = parkSchedules[transaction.parkID].closeDateTime;
        orderPromises.push(orderMaxPass(transaction.parkID, transaction.rideID, parkDate, parkCloseDateTime, passIDs, disID, accessToken, tz));
    }

    var dbUpdatePromises = [];
    var passIDs = [];
    //Maps usersID to array of fastpasses
    var updates = {};
    var orderResults = await Promise.all(orderPromises);
    orderResults.forEach((orderResult, transactionI) => {
        var transaction = transactions[transactionI];
        if (orderResult == "Conflict") {
            return;
        }
        if (orderResult == "NoMaxPass") {
            for (var passID in transaction.passes) {
                var pass = transaction.passes[passID];
                if (updates[pass.userID] == null) {
                    updates[pass.userID] = [];
                }
                updates[pass.userID].push({
                    passID: pass.passID,
                    rideID: transaction.rideID,
                    error: "FastPasses no longer available"
                });
                passIDs.push(passID);
            }
            dbUpdatePromises.push(query(`DELETE FROM PlannedFpTransactions WHERE id=?`, [transaction.id]));

            return;
        }

        var fastPassDateTime = orderResult["fastPassDateTime"];
        var entitlements = [];
        entitlements.push({
            "startDateTime": fastPassDateTime
        });
        for (var passSelectionTime of orderResult.passes) {
            var passID = passSelectionTime["passID"];
            var selectionDateTime = passSelectionTime["selectionDateTime"];
            var earliestSelectionDateTime = null;
            if (selectionDateTime != null) {
                earliestSelectionDateTime = passes.getEarliestPossibleSelectionDateTime(selectionDateTime, entitlements);
            }
            dbUpdatePromises.push(query(`INSERT INTO PassSelectionTimes VALUES ?
                ON DUPLICATE KEY UPDATE selectionTime=?, earliestSelectionTime=?`, [
                [[passID, 
                (selectionDateTime != null)? selectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null, 
                (earliestSelectionDateTime != null)? earliestSelectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null]],
                (selectionDateTime != null)? selectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null, 
                (earliestSelectionDateTime != null)? earliestSelectionDateTime.format("YYYY-MM-DD HH:mm:ss"): null
            ]));
            passIDs.push(passID);

            var pass = transaction.passes[passID];
            if (updates[pass.userID] == null) {
                updates[pass.userID] = [];
            }
            updates[pass.userID].push({
                passID: pass.passID,
                rideID: transaction.rideID,
                fastPassDateTime: fastPassDateTime.format("YYYY-MM-DD HH:mm:ss")
            });
        }
        dbUpdatePromises.push(query(`DELETE FROM PlannedFpTransactions WHERE id=?`, [transaction.id]));
    });
    if (passIDs.length > 0) {
        dbUpdatePromises.push(query(`UPDATE FpTransactionPasses SET 
            priority=priority-1 
            WHERE passID IN (?)`, [passIDs]));
    }
    
    await Promise.all(dbUpdatePromises);
    
    return updates;
}

async function orderMaxPass(parkID, rideID, date, parkCloseDateTime, passIDs, disID, accessToken, tz) {
    try {
        var result = await passes.orderPartyMaxPass(parkID, rideID, date, parkCloseDateTime, passIDs, disID, accessToken, tz);
        if (result == null) {
            return "NoMaxPass";
        }
        return result;
    } catch (ex) {
        console.log("EX: ", ex);
        return "Conflict";
    }
}

module.exports = {
    getFastPasses: getFastPasses,
    updatePlannedTransactions: updatePlannedTransactions,
    pollSelectionUpdates: pollSelectionUpdates,
    getActiveTransactions: getActiveTransactions,
    pollMaxPassOrders: pollMaxPassOrders,
    deleteInvalidPlannedFastPasses: deleteInvalidPlannedFastPasses
};