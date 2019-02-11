var profanity = require('./Profanity.js');
var imageUploader = require('./ImageUploader');

var uuidv4 = require('uuid/v4');

var USER_QUERY = `u.id AS id, u.name AS name, pp.url AS profilePicUrl`;
var FRIEND_INVITE_TYPE = 0;
var PARTY_INVITE_TYPE = 1;
var IMAGE_SIZES = [250, 500, 750, 1000];

function getUserFromRow(row) {
    return {
        id: row["id"],
        name: row["name"],
        profilePicUrl: row["profilePicUrl"]
    }
}

async function _addUserToMySql(userID, name, isDefaultName, query) {
    await query('INSERT INTO Users VALUES ?', [[[userID, name, isDefaultName]]]);
}

async function _getDefaultName(query) {
    var nameCounts = await query(`SELECT name, count FROM DefaultNames`);
    var rowI = Math.trunc(Math.random() * nameCounts.length);
    var name = nameCounts[rowI].name + nameCounts[rowI].count.toString();
    await query(`UPDATE DefaultNames SET count=? WHERE name=?`, [nameCounts[rowI].count + 1, nameCounts[rowI].name]);
    return name;
}

async function createUser(userID, name, query) {
    var user = await getUser(userID, query);
    if (user != null) {
        throw "User already exists";
    }
    if (name != null) {
        if (profanity.containsProfanity(name)) {
            throw "Name contains profanity";
        }
        await _addUserToMySql(userID, name, false, query)
    }
    else {
        name = await _getDefaultName(query);
        await _addUserToMySql(userID, name, true, query);
    }
}

async function renameUser(userID, name, query) {
    if (profanity.containsProfanity(name)) {
        throw "Name contains profanity";
    }
    await query(`UPDATE Users SET name=? AND defaultName=? WHERE id=?`, [name, false, userID]);
}

async function _isImageAppropiate(pic, imageAnnotatorClient) {
    var annotateResults = await imageAnnotatorClient
        .safeSearchDetection(pic);
    var annotations = annotateResults[0].safeSearchAnnotation;

    var checkCategories = [ "adult", "medical", "violence", "racy" ];
    var passingRatings = [ "UNLIKELY", "VERY_UNLIKELY" ]; 
    for (var category of checkCategories) {
        if (passingRatings.indexOf(annotations[category]) < 0) {
            return false;
        }
    }
    return true;
}

async function updateProfilePic(userID, bucket, objKey, query, s3Client, imageAnnotatorClient) {
    var getParams = {
        Bucket: bucket,
        Key: objKey
    }

    var picData = await s3Client.getObject(getParams).promise();
    var pic = picData.Body;
    var isAppropiate = await _isImageAppropiate(pic, imageAnnotatorClient);
    if (!isAppropiate) {
        throw "Image may contain inappropiate content!";
    }

    var newKeyPrefix = `profileImgs/${userID}`;
    await imageUploader.uploadImageDataOfSizes(pic, IMAGE_SIZES, bucket, newKeyPrefix, s3Client);

    await query(`INSERT INTO ProfilePictures VALUES ? ON DUPLICATE KEY UPDATE url=?`, [[[userID, newKeyPrefix]], newKeyPrefix]);
    return newKeyPrefix;
}

async function getUsers(userIDs, query) {
    var users = await query(`SELECT ${USER_QUERY}  
        FROM Users u
        LEFT JOIN ProfilePictures pp ON pp.userId=u.id
        WHERE u.id IN (?)`, [userIDs]);
    return users;
}

async function getUser(userID, query) {
    var users = await query(`SELECT ${USER_QUERY} 
        FROM Users u
        LEFT JOIN ProfilePictures pp ON pp.userId=u.id 
        WHERE u.id=?`, userID);
    if (users.size == 0) {
        return null;
    }
    return users[0];
}

async function searchUsers(prefix, userID, query) {
    var prefixWildcard = prefix + '%';
    var users = await query(`SELECT ${USER_QUERY}
        FROM Users u
        LEFT JOIN ProfilePictures pp ON u.id=pp.userId 
        WHERE LCASE(u.name) LIKE ? AND u.id != ? ORDER BY LENGTH(u.name), u.name LIMIT 50`, [prefixWildcard, userID]);
    return users;
}

//INVITES
async function getInvites(userID, type, query) {
    var typeStr = ``;
    var queryArgs = [userID, userID, userID];
    if (type != null) {
        typeStr = `AND i.type=?`;
        queryArgs.push(type);
    }

    var result = await query(`SELECT (i.inviterId=?) AS isOwner, i.type AS type, 
        ${USER_QUERY},
        f.userId AS friendID
        FROM Invitations i
        INNER JOIN Users u ON i.inviterId=u.id OR i.receiverId=u.id
        LEFT JOIN ProfilePictures pp ON pp.userId=u.id
        LEFT JOIN Friends ON (i.inviterId=f.userId OR i.receiverId=f.userId) AND f.userId != ?
        WHERE u.id=? ${typeStr}`, queryArgs);
    
    var invites = [];
    for (var row of result) {
        var isOwner = (row.isOwner == 1);
        var isFriend = (row.friendID != null);
        invites.push({
            isOwner: isOwner, isFriend: isFriend, type: row.type, user: getUserFromRow(row)
        });
    }
    return invites
}

async function hasInvite(ownerID, receiverID, type, query) {
    var inviteMatches = await query(`SELECT inviterId AS ownerID
        FROM Invitations
        WHERE inviterId=? AND receiverId=? AND type=?`, [ownerID, receiverID, type]);
    
    return (inviteMatches.length == 1);
}

async function createInvite(inviterID, receiverID, type, query) {
    await query('INSERT INTO Invitations VALUES ?', [[[inviterID, receiverID, type]]]);
}

async function deleteInvite(ownerID, receiverID, type, query) {
    await query('DELETE FROM Invitations WHERE (inviterId=? AND receiverId=?) AND type=?', [ownerID, receiverID, type]);
}

async function deleteInvites(ownerID, type, query) {
    await query('DELETE FROM Invitations WHERE inviterId=? AND type=?', [ownerID, type]);
}

//FRIENDS
async function getFriends(userID, query) {
    var users = await query(`SELECT ${USER_QUERY}
        FROM Users u
        INNER JOIN Friends f ON f.friendId=u.id
        LEFT JOIN ProfilePictures pp ON u.id=pp.userId
        WHERE f.userId=?`, [userID]);
    return users;
}

async function areFriends(userID, friendIDs, query) {
    var friendCountResult = await query(`SELECT COUNT(*) AS count
        FROM Friends f
        WHERE f.userId=? AND f.friendId IN (?)`, [userID, friendIDs]);
    return friendCountResult[0].count == friendIDs.length;
}

async function addFriend(userID, friendID, query) {
    var friendMatchCounts = await query(`SELECT COUNT(*) AS count FROM Friends 
        WHERE userId=? AND friendId=?`, [userID, friendID]);
    
    //If friend exists return
    if (friendMatchCounts[0].count > 0) {
        return true;
    }
    
    //Both a friend or party invite are enough to add as a friend
    var hasAnyInvite = (await hasInvite(friendID, userID, FRIEND_INVITE_TYPE, query) || await hasInvite(friendID, userID, PARTY_INVITE_TYPE, query));

    //If not invited, send invite
    if (hasAnyInvite) {
        var values = [
            [userID, friendID],
            [friendID, userID]
        ];

        await query(`INSERT INTO Friends VALUES ?`, [values]);
        await deleteInvite(userID, friendID, FRIEND_INVITE_TYPE, query);  //Delete all friend invitations between the two users
        await deleteInvite(friendID, userID, FRIEND_INVITE_TYPE, query);
        return true;
    }

    var hasInviteToFriend = (await hasInvite(userID, friendID, FRIEND_INVITE_TYPE, query)  || await hasInvite(friendID, userID, PARTY_INVITE_TYPE, query));
    if (!hasInviteToFriend) {
        createInvite(userID, friendID, FRIEND_INVITE_TYPE, query);
        return false;
    }
    //If you reached here, you've tried to accept your own invitation to another friend
    return false;
}

async function removeFriend(userID, friendID, query) {
    await query(`DELETE FROM Friends 
        WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)`, [userID, friendID, friendID, userID]);
}

//PARTIES
async function getPartyID(userID, query) {
    var partyIDMatches = await query(`SELECT id AS partyID FROM Parties 
        WHERE userID=?`, [userID]);
    if (partyIDMatches == 0) {
        return null;
    }
    return partyIDMatches[0].partyID;
}

async function getUserIDsForParty(partyID, query) {
    var userIDMatches = await query(`SELECT userID FROM Parties WHERE id=?`, [partyID]);
    var userIDs = [];
    if (userIDMatches.length > 0) {
        for (var userIDMatch of userIDMatches) {
            userIDs.push(userIDMatch.userID);
        }
    }
    return userIDs;
}

async function getPartyMembers(userID, query) {
    var partyID = await(getPartyID(userID, query));
    return await getPartyMembersForParty(partyID, query);
}

async function getPartyMembersForParty(partyID, query) {
    var userIDs = await(getUserIDsForParty(partyID, query));
    var getUserPromises = [];
    for (var userID of userIDs) {
        getUserPromises.push(getUser(userID, query));
    }
    var userInfos = await(Promise.all(getUserPromises));
    return userInfos;
}

async function inviteToParty(userID, memberID, query) {
    if (await hasInvite(userID, memberID, PARTY_INVITE_TYPE, query)) {
        throw "Invite to party already exists";
    }
    var partyID = await getPartyID(userID, query);
    if (partyID == null) {
        partyID = uuidv4();
        await query(`INSERT INTO Parties VALUES ?`, [[[partyID, userID]]]);
    } else {
        var memberPartyID = await getPartyID(memberID, query);
        if (memberPartyID == partyID) {
            throw "User already a member of this party";
        }
    }
    await createInvite(userID, memberID, PARTY_INVITE_TYPE, query);
}

async function leaveParty(userID, query) {
    await query(`DELETE FROM Parties WHERE userID=?`, userID);
    await deleteInvites(userID, PARTY_INVITE_TYPE, query);  //Delete all outgoing party invites
}

async function _joinParty(userID, partyID, query) {
    await query(`INSERT INTO Parties VALUES ? ON DUPLICATE KEY UPDATE id=?`, [[[partyID, userID]], partyID]);
}

async function acceptPartyInvite(userID, inviterID, query) {
    var hasPartyInvite = await hasInvite(inviterID, userID, PARTY_INVITE_TYPE, query);
    if (!hasPartyInvite) {
        throw "Party invititation does not exist";
    }
    var ownerIsFriend = await areFriends(inviterID, [userID], query);
    if (!ownerIsFriend) {
        await addFriend(userID, inviterID, query);
    }
    await leaveParty(userID, query);
    var partyID = await getPartyID(inviterID, query);
    if (partyID == null) {
        var result = await query(`SELECT * FROM Parties`);
        //Should never hit
        throw "User is not in a party";
    }
    var members = await getPartyMembersForParty(partyID, query);
    var deletePromises = [];
    for (var member of members) {
        deletePromises.push(deleteInvite(member.id, userID, PARTY_INVITE_TYPE, query));
    }
    if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
    }
    await _joinParty(userID, partyID, query);
}

module.exports = {
	createUser: createUser,
	renameUser: renameUser,
    updateProfilePic: updateProfilePic,
    getUsers: getUsers,
    getUser: getUser,
    searchUsers: searchUsers,
    getInvites: getInvites,
    deleteInvite: deleteInvite,
    getFriends: getFriends,
    addFriend: addFriend,
    removeFriend: removeFriend,
    areFriends: areFriends,
    getPartyMembers: getPartyMembers,
    inviteToParty: inviteToParty,
    leaveParty: leaveParty,
    acceptPartyInvite: acceptPartyInvite,
    FRIEND_INVITE_TYPE: FRIEND_INVITE_TYPE,
    PARTY_INVITE_TYPE: PARTY_INVITE_TYPE
};