/*
    CREATE TABLE PlannedFpTransactions(id varchar(100), userID varchar(50), rideID int(11), partyID varchar(200), PRIMARY KEY(id), FOREIGN KEY (userID) REFERENCES Users(id), FOREIGN KEY (rideID) REFERENCES Rides(id), FOREIGN KEY (partyID) REFERENCES Parties(id));
    CREATE TABLE FpTransactionPasses(transactionID varchar(100), userID varchar(50), passID varchar(200), priority INT, PRIMARY KEY(transactionID, passID), FOREIGN KEY(transactionID) REFERENCES PlannedFpTransactions(id), FOREIGN KEY (passID, userID) REFERENCES ParkPasses(id, ownerID));
*/
var moment = require('moment-timezone');
var uuidv4 = require('uuid/v4');

//New FastPassManager relies less on the database
var passes = require('../dis/Pass');
var passManager = require('./PassManager');
var predictionManager = require('./Predictions');

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
        transaction.selectionTime = getLatestSelectionTime(transactionSelectionTimes, tz);
        transaction.fastPassTime = await predictionManager.getFastPassPrediction(transaction.rideID, transaction.selectionTime, query);
        transaction.passesToNextSelectionTime = {};
        for (var passID in transaction.passesToPriorities) {
            var pass = passes[passID];
            var nextSelectionTime = getNextSelectionTime(pass.hasMaxPass, transaction.selectionTime, transaction.fastPassTime);
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
async function getPlannedTransactions(userIDs, passes, tz, query) {
    var transactionPasses = await query(`SELECT tp.transactionID AS transactionID, t.rideID AS rideID, p.id AS passID, p.ownerID AS userID, tp.priority
        FROM FpTransactionPasses tp 
        INNER JOIN PlannedFpTransactions t ON tp.transactionID=t.id
        INNER JOIN ParkPasses p ON tp.passID=p.id AND tp.userID=p.ownerID
        WHERE p.isEnabled=1 AND tp.userID IN (?) ORDER BY tp.priority`, [userIDs]);
    
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
                selectionTime: null,
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
            selectionDateTime: transaction.selectionTime,
            passSelectionDateTime: transaction,
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
async function updatePlannedTransactions(plannedTransactions, userIDs, tz, query) {
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
    var userPassesArr = await passManager.getPassesForUsers(userIDs, false, tz, query);
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
    //Delete all previous transactions for passes in party
    await query(`DELETE FROM FpTransactionPasses WHERE passID IN (?)`, Object.keys(userPassIDs));
    await query(`DELETE pfpt FROM PlannedFpTransactions  pfpt
        LEFT JOIN FpTransactionPasses ftp ON ftp.transactionID=pfpt.id 
        WHERE ftp.transactionID IS NULL`);

    //Insert all the new transactions and transactionPasses
    var insertTransactionPromises = [];
    for (var transaction of plannedTransactions) {
        insertTransactionPromises.push(
            query(`INSERT INTO PlannedFpTransactions VALUES ?`, [[[transaction.id, transaction.rideID]]])
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

/*
    Response: {
        selectionTime,
        earliestSelectionTime,
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
async function getFastPasses(userIDs, accessToken, tz, query) {
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
    for (fpResp of fastPassData.individualResps) {
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
            pass: pass,
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
                [[[passID, passInfo.latestSelectionTime.format("YYYY-MM-DD HH:mm:ss"), passInfo.selectionTime.format("YYYY-MM-DD HH:mm:ss")]], 
                passInfo.latestSelectionTime.format("YYYY-MM-DD HH:mm:ss"), passInfo.selectionTime.format("YYYY-MM-DD HH:mm:ss")]));
    }

    var plannedTransactions = await getPlannedTransactions(userIDs, passIDsToInfo, tz, query);

    var allUserPasses = [];
    for (var userID in userIDsToAllUserPasses) {
        allUserPasses.push(userIDsToAllUserPasses[userID]);
    }
    await Promise.all(dbUpdatePromises);
    var result = {
        selectionDateTime: fastPassData.selectionDateTime, 
        earliestSelectionDateTime: fastPassData.earliestSelectionDateTime,
        transactions: fastPassData.transactions,
        plannedTransactions: plannedTransactions,
        allUserPasses: allUserPasses
    };
    return result;
}

module.exports = {
    getFastPasses: getFastPasses,
    updatePlannedTransactions: updatePlannedTransactions
};