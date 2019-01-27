var config = require('./config');

var rp = require('request-promise-native');
var passes = require('../dis/Pass');
var auth = require('../dis/Auth');

var username = config.dis.username;
var password = config.dis.password;
var passID = config.dis.passID;

jest.mock('request-promise-native');

var passResp = {
    "productINstance": {},
    "entitlement": {
        "visualId": "2",
        "name": "Signature Plus Passport",
        "governmentIdLinked": false,
        "sku": "0",
        "productInstanceId": "0",
        "status": "ACTIVE",
        "owner": {
            "profileId": "DEFAULT",
            "ownerType": "B2C"
        },
        "primaryGuest": "disID0",
        "shared": true,
        "sharedWith": [
            "disID1",
            "disID2"
        ],
        "assignedGuest": {
            "nickname": "JOHN DOE",
            "firstName": "JOHN",
            "lastName": "DOE"
        },
        "productTypeId": "signature-plus",
        "category": {
            "id": "AnnualPass",
            "name": "Annual Passes"
        },
        "featureIds": [
            "MaxPass"
        ],
        "voidable": false,
        "guestAgeGroup": "ALL_AGES",
        "addons": [
            {
                "visualId": "0",
                "parentVisualId": "2",
                "name": "Standalone MaxPass",
                "orderConfirmationNumber": "0",
                "governmentIdLinked": false,
                "sku": "0",
                "productInstanceId": "0",
                "status": "ACTIVE",
                "exchangeStatus": "NOT_ELIGIBLE",
                "owner": {
                    "profileId": "disID1",
                    "ownerType": "B2C"
                },
                "primaryGuest": "disID1",
                "shared": false,
                "assignedGuest": {
                    "nickname": "JOHN DOE",
                    "firstName": "JOHN",
                    "lastName": "DOE"
                },
                "productTypeId": "dlr-maxpass",
                "category": {
                    "id": "MaxPass",
                    "name": "MaxPass"
                },
                "featureIds": [
                    "StandaloneMaxPass"
                ],
                "voidable": false,
                "guestAgeGroup": "ALL_AGES",
                "remainingUse": 0,
                "useCount": 0,
                "primaryGuestLinked": false,
                "renewable": false,
                "modifiable": false,
                "skipRenewal": false,
                "sourceLexvas": true,
                "packageEntitlement": false,
                "mainEntrancePass": false,
                "startDateTime": "2017-09-10T06:00:00.000-07:00",
                "endDateTime": "2017-09-11T05:59:00.000-07:00"
            }
        ],
        "remainingUse": 180,
        "useCount": 337,
        "daysRemaining": "180",
        "primaryGuestLinked": false,
        "linkedDateTime": "2018-08-12T23:12:54.000-07:00",
        "renewable": false,
        "modifiable": false,
        "skipRenewal": false,
        "passType": "SIGNTURE",
        "renewEligibility": "PARKING",
        "entitlementUpgradeStatus": "INELIGIBLE",
        "parkHopper": true,
        "sourceLexvas": true,
        "packageEntitlement": false,
        "mainEntrancePass": false,
        "startDateTime": "2017-06-27T00:00:00.000-07:00",
        "endDateTime": "2019-07-25T00:00:00.000-07:00"
    }
};

var twoFastPassResp = {
    "partyMembers": [
        {
            "name": "MARY SUE",
            "nextSelectionTime": "2019-01-11T18:45:00-08:00",
            "managed": false,
            "annualPass": true,
            "id": "1",
            "ticketType": "PASS"
        },
        {
            "name": "JOHN DOE",
            "nextSelectionTime": "2019-01-11T18:45:00-08:00",
            "managed": true,
            "annualPass": true,
            "id": "2",
            "ticketType": "PASS"
        }
    ],
    "entitlements": [
        {
            "startDateTime": "2019-01-12T02:30:00Z",  //2019-01-11 18:45
            "endDateTime": "2019-01-12T03:30:00Z",    //2019-01-11 19:45
            "operationalDate": "2019-01-11",
            "facilityType": "Attraction",
            "locationId": "l1",
            "locationType": "Attraction",
            "parkId": "336894",
            "partyGuests": [
                {
                    "guestId": "1",
                    "entitlementId": "0",
                    "status": "Booked",
                    "canModify": true,
                    "canCancel": true,
                    "canRedeem": false
                },
                {
                    "guestId": "2",
                    "entitlementId": "0",
                    "status": "Booked",
                    "canModify": true,
                    "canCancel": true,
                    "canRedeem": false
                }
            ],
            "facility": "15822029",
            "isBonus": false
        },
        {
            "startDateTime": "2019-01-12T02:40:00Z",
            "endDateTime": "2019-01-12T03:40:00Z",
            "operationalDate": "2019-01-11",
            "facilityType": "Attraction",
            "locationId": "l2",
            "locationType": "Attraction",
            "parkId": "330339",
            "partyGuests": [
                {
                    "guestId": "2",
                    "entitlementId": "0",
                    "status": "Booked",
                    "canModify": true,
                    "canCancel": true,
                    "canRedeem": false
                }
            ],
            "facility": "353301",
            "isBonus": false
        }
    ]
};

var oneFastPassResp = {
    "partyMembers": [
        {
            "name": "ALEX CRAIG",
            "nextSelectionTime": "2019-01-11T18:25:00-08:00",
            "managed": false,
            "annualPass": true,
            "id": "3",
            "ticketType": "PASS"
        }
    ],
    "entitlements": [
        {
            "startDateTime": "2019-01-12T02:25:00Z",  //2019-01-11 18:45
            "endDateTime": "2019-01-12T03:25:00Z",    //2019-01-11 19:45
            "operationalDate": "2019-01-11",
            "facilityType": "Attraction",
            "locationId": "l1",
            "locationType": "Attraction",
            "parkId": "336894",
            "partyGuests": [
                {
                    "guestId": "3",
                    "entitlementId": "0",
                    "status": "Booked",
                    "canModify": true,
                    "canCancel": true,
                    "canRedeem": false
                }
            ],
            "facility": "15822029",
            "isBonus": false
        },
        {
            "startDateTime": "2019-01-12T02:55:00Z",
            "endDateTime": "2019-01-12T03:55:00Z",
            "operationalDate": "2019-01-11",
            "facilityType": "Attraction",
            "locationId": "l2",
            "locationType": "Attraction",
            "parkId": "330339",
            "partyGuests": [
                {
                    "guestId": "3",
                    "entitlementId": "0",
                    "status": "Booked",
                    "canModify": true,
                    "canCancel": true,
                    "canRedeem": false
                }
            ],
            "facility": "353301",
            "isBonus": false
        },
        {
            "startDateTime": "2019-01-12T02:45:00Z",
            "endDateTime": "2019-01-12T03:45:00Z",
            "operationalDate": "2019-01-11",
            "facilityType": "Attraction",
            "locationId": "l3",
            "locationType": "Attraction",
            "parkId": "330339",
            "partyGuests": [
                {
                    "guestId": "3",
                    "entitlementId": "0",
                    "status": "Booked",
                    "canModify": true,
                    "canCancel": true,
                    "canRedeem": false
                }
            ],
            "facility": "353301",
            "isBonus": false
        }
    ]
};

test('pass Mock', async () => {
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(passResp);
    }));
    var fastPasses = await passes.getPass('passID', 'accessToken')
    expect(fastPasses).toEqual(passResp["entitlement"]);
});

test('fastPass Mock', async () => {
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(twoFastPassResp);
    }));
    var fastPasses = await passes.getFastPasses('disID', 'accessToken');
    expect(fastPasses).toEqual(twoFastPassResp);
});

test('fastPass Filtered', async () => {
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(twoFastPassResp);
    }));
    {
        var fastPasses = await passes.getFastPassesForPassID('1', 'disID', 'accessToken', "America/Los_Angeles");
        expect(fastPasses['passID']).toBe('1');
        expect(fastPasses['disID']).toBe('disID');
        expect(fastPasses['selectionDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:45');
        expect(fastPasses['earliestSelectionDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:30');
        expect(fastPasses["resp"]).toEqual(twoFastPassResp);
    }
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(twoFastPassResp);
    }));
    {
        var fastPasses = await passes.getFastPassesForPassID('2', 'disID', 'accessToken', "America/Los_Angeles");
        expect(fastPasses['passID']).toBe('2');
        expect(fastPasses['disID']).toBe('disID');
        expect(fastPasses['selectionDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:45');
        expect(fastPasses['earliestSelectionDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:40');
        expect(fastPasses['entitlements'].length).toBe(2);
        expect(fastPasses['entitlements'][0]["startDateTime"].format('YYYY-MM-DD HH:mm')).toBe("2019-01-11 18:30");
        expect(fastPasses['entitlements'][0]["endDateTime"].format('YYYY-MM-DD HH:mm')).toBe("2019-01-11 19:30");
        expect(fastPasses["resp"]).toEqual(twoFastPassResp);
    }
});

test('fastPass Aggregated', async () => {
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(twoFastPassResp);
    }));
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(twoFastPassResp);
    }));
    rp.mockResolvedValueOnce(new Promise((resolve) => {
        resolve(oneFastPassResp);
    }));
    var passAndDisIDs = [
        { passID: '1', disID: 'disID1' },
        { passID: '2', disID: 'disID2' },
        { passID: '3', disID: 'disID3' }
    ];
    var fastPasses = await passes.aggregateFastPassesForPassIDs(passAndDisIDs, 'accessToken', "America/Los_Angeles");
    expect(fastPasses['selectionDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:45');
    expect(fastPasses['earliestSelectionDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:40');
    expect(fastPasses['transactions'].length).toBe(4);
    {
        var transaction = fastPasses['transactions'][0];
        expect(transaction['rideID']).toBe('l1');
        expect(transaction['startDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:30');
        expect(transaction['endDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 19:25');
        var passIDs = [];
        for (var fp of transaction['fps']) {
            passIDs.push(fp.passID);
        }
        expect(passIDs.sort()).toEqual(['1', '2', '3'].sort());
    }
    {
        var transaction = fastPasses['transactions'][1];
        expect(transaction['rideID']).toBe('l2');
        expect(transaction['startDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:40');
        expect(transaction['endDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 19:40');
        var passIDs = [];
        for (var fp of transaction['fps']) {
            passIDs.push(fp.passID);
        }
        expect(passIDs).toEqual(['2']);
    }
    {
        var transaction = fastPasses['transactions'][2];
        expect(transaction['rideID']).toBe('l3');
        expect(transaction['startDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:45');
        expect(transaction['endDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 19:45');
        var passIDs = [];
        for (var fp of transaction['fps']) {
            passIDs.push(fp.passID);
        }
        expect(passIDs).toEqual(['3']);
    }
    {
        var transaction = fastPasses['transactions'][3];
        expect(transaction['rideID']).toBe('l2');
        expect(transaction['startDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 18:55');
        expect(transaction['endDateTime'].format('YYYY-MM-DD HH:mm')).toBe('2019-01-11 19:55');
        var passIDs = [];
        for (var fp of transaction['fps']) {
            passIDs.push(fp.passID);
        }
        expect(passIDs).toEqual(['3']);
    }
});

//run fastPass flow without exceptions
test('fastPass Real', async () => {
    //Disable mock rp so that actual requests can be made in this test
    rp.mockImplementation(
        require.requireActual('request-promise-native')
    );
    var tokenInfo = await auth.login(username, password);
    var accessToken = tokenInfo["accessToken"];
    var pass = await passes.getPass(passID, accessToken);
    var disID = pass.primaryGuest;
    var fastPasses = await passes.getFastPasses(disID, accessToken);
    expect(fastPasses).toBeTruthy();
});