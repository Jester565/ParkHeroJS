/*
    CREATE TABLE PlannedFpTransactions(id varchar(100), userID varchar(50), rideID int(11), partyID varchar(200), PRIMARY KEY(id), FOREIGN KEY (userID) REFERENCES Users(id), FOREIGN KEY (rideID) REFERENCES Rides(id), FOREIGN KEY (partyID) REFERENCES Parties(id));
    CREATE TABLE FpTransactionPasses(transactionID varchar(100), userID varchar(50), passID varchar(200), priority INT, PRIMARY KEY(transactionID, passID), FOREIGN KEY(transactionID) REFERENCES PlannedFpTransactions(id), FOREIGN KEY (passID, userID) REFERENCES ParkPasses(id, ownerID));
*/


//New FastPassManager relies less on the database
var passes = require('../dis/Pass');
var passManager = require('./PassManager');
var predictionManager = require('./Predictions');

function getLatestSelectionTime(selectionTimes, tz) {
    var latestSelectionTime = moment().tz(tz);
    for (var selectionTime of selectionTimes) {
        var selectionTime = pass[passID];
        if (selectionTime > latestSelectionTime) {
            latestSelectionTime = selectionTime;
        }
    }
    return latestSelectionTime;
}

function getNextSelectionTime(hasMaxPass, latestSelectionTime, minsToFastPass) {
    var maxSelectionWaitMins = 120;
    if (hasMaxPass) {
        maxSelectionWaitMins = 90;
    }
    var nextSelectionTime = null;
    if (minsToFastPass <= maxSelectionWaitMins) {
        nextSelectionTime = fpTime;
    } else {
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
    transaction.passesToPriorities[passID] = priority;
    if (transaction.passCount == Object.keys(transaction.passesToPriorities).length) {
        var transactionSelectionTimes = [];
        for (var passID in transaction.passesToPriorities) {
            if (nextSelectionTimes[passID] != null) {
                transactionSelectionTimes.push(nextSelectionTimes[passID]);
            }
        }
        transaction.selectionTime = getLatestSelectionTime(transactionSelectionTimes, tz);
        transaction.fastPassTime = await predictionManager.getFastPassPrediction(rideID, latestSelectionTime, query);

        var minsToFastPass = moment.duration(fpTime.diff(latestSelectionTime)).asMinutes();
        for (var passID in transaction.passesToPriorities) {
            var pass = passes[passID];
            var nextSelectionTime = getNextSelectionTime(pass.hasMaxPass, latestTransactionSelectionTime, minsToFastPass);
            nextSelectionTimes[passID] = nextSelectionTime;
            var passPriority = transaction.passesToPriorities[passID];
            var nextTransactionID = passToTransactionIDs[passID][passPriority + 1];
            await processTransaction(nextTransactionID, passID, passPriority);
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
        INNER JOIN Passes p ON tp.passID=p.passID AND tp.userID=p.ownerID
        WHERE p.isEnabled=1 AND tp.userID IN (?) ORDER BY tp.priority`, [partyID, userIDs]);
    
    //{ rideID, passCount, passesToPriorities: <passID, priority>, selectionTime, fpTime }
    var transactions = { };
    //Map <passID, <priority, transactionIDs>>: Used so we can figure out what the next transactionID is for a particular pass
    var passToTransactionIDs = {  };

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
        await processTransaction(tp.transactionID, tp.passID, tp.priority,
            transactions, passToTransactionIDs, nextSelectionTimes,
            passes, tz, query);
        if (tp.priority > 0) {
            break;
        }
    }
    var results = [];
    for (var transactionID in transactions) {
        var transaction = transactions[transactionID];
        var passPriorities = [];
        for (var passID in transaction.passesToPriorities) {
            var priority = transaction.passesToPriorities[passID];
            passPriorities.push({
                passID: passID,
                priority: priority
            });
        }
        results.push({
            rideID: transaction.rideID,
            selectionDateTime: transaction.selectionTime.format("YYYY-MM-DD HH:mm:ss"),
            fastPassTime: transaction.fastPassTime.format("YYYY-MM-DD HH:mm:ss"),
            passPriorities: passPriorities
        });
    }

    return results;
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
                passID,
                startDateTime,
                endDateTime
            }]
        }],
        plannedTransactions: [{
            rideID,
            selectionTime,
            fastPassTime,
            passes: [{
                passID,
                priority
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
        for (var pass of userPasses) {
            passIDsToUserPasses[pass.id] = { "user": user, "pass": pass };
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
            hasMaxPass: fpResp.hasMaxPass
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

    var plannedTransactions = await getPlannedTransactions(userIDs, passIDsToInfo, tz, query);

    var result = {
        selectionDateTime: fastPassData.selectionDateTime, 
        earliestSelectionDateTime: fastPassData.earliestSelectionDateTime,
        transactions: fastPassData.transactions,
        plannedTransactions: plannedTransactions,
        allUserPasses: allUserPasses
    };
    return result;
}