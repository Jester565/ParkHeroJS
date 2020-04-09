# ParkHeroJS
Part of the [ParkHero Project](https://github.com/Jester565/ParkHeroReactNative)

Nodejs module to run the <b>serverless</b>, back end for [ParkHeroReactNative](https://github.com/Jester565/ParkHeroReactNative).  This project is designed to be modular to account for the future changes in Disney's API.

| Folder or File | Description | Depends On |
| ----------- | ----------- | ---------- |
| Router.js    | Dispatches GraphQL requests & cron jobs to api handler | api/ core/ dis/ 
| api/        | High-Level handlers that are passed the GraphQL requests | core/ dis/ | 
| core/       | Core logic of the back end (order FastPasses, predictions, etc.) | dis/ |
| dis/        | Client for Disney's unoffical API | - |
| tests/      | Tests core logic (mocks Disney API) | core/ |

# API

The API is a GraphQL API deployed on AWS AppSync and AWS Lambda.

## Attractions (Rides + Resort)

| Endpoint | Method | Params | Return Type | Description |
| -- | -- | -- | -- | -- |
| getRides | Query | - | [[Ride](#ride)] | Get all rides and the wait times & fastpasses stored in db |
| getRideTimes | Mutation | - | [[Ride](#ride)] | Get the latest wait and Fastpass data from Disney's API & update the database |
| getRideDPs | Query | <b>date</b>: String ("2019-05-30")<br/><b>rideID</b>: String | [[RideDataPoints](#ridedatapoints)] | Provides more static information on the ride with <i>rideID</i> as well as all wait times and FastPasses for the <i>date</i> |
| getEvents | Query | <b>date</b>: String ("2019-05-30") | [[Event](#event)] | Get all events (ex. Fantasmic) and the times they are showing |
| updateCustomAttractionInfo | Mutation | <b>attractionID</b>: String! <br/> <b>customName</b>: String ("Thunder") <br /> <b>pics</b>: [Pic] | - | For the <i>attractionID</i> (either a Ride or Event), update the <i>customName</i> if not null (no profanity check since user only).  Update the order of the pictures to match the provided <i>pics</i> array.  If `pic.added=true`, save the image to S3. |
| updateFilter | Mutation | <b>filterName</b>: String! <br /> <b>attractionIDs</b>: [String] <br /> <b>filterType</b>: String ("ride" or "event") <br /> <b>watchConfig</b>: [WatchConfig](#watchconfig) | - | Create or update filter with new attractions and notification preferences (<i>watchConfig</i>) |
| getFilters | Query | - | [[Filter](#filter)] | Get attraction filters belonging to the user |
| deleteFilters | Mutation | <b>filterNames</b>: [String] <br /> <b>filterType</b>: String | - | Delete all filters in <i>filterNames</i> belonging to the same <i>fitlerType</i> |
| getSchedules | Query | - | [[ParkSchedule](#parkschedule)] | Get schedules for the Disneyland resort |
| getWeather | Query | <b>date</b>: String ("2019-05-30") | [[Weather](#weather)] | get 24 Weather entries for the <i>date</i> (index corresponds to hour) |

## Users

| Endpoint | Method | Params | Return Type | Description |
| -- | -- | -- | -- | -- |
| createUser | Mutation | <b>name</b>: String | [User](#user) | On first start, create user and can provide an optional <i>name</i> (will be checked for profanity) |
| updateUser | Mutation | <b>name</b>: String <br/> <b>imgUri</b>: String ("data:image/gif;base64,R0l...") | [User](#user) | If <i>name</i> provided, update profile name. <i>imgUri</i> is URI encoded <u>image data</u> to set as profilePic if not null. Returns updated user. |
| verifySNS | Mutation | <b>token</b>: String! <br/> <b>endpointArn</b>: String  <br/> <b>subscriptionArn</b>: String <br/> <b>endpointUserID</b>: String | [VerifySnsResult](#verifysnsresult) | Create a new SNS topic to send notifications directly to the user. <br /> Use the <i>token</i> to create a new SNS endpoint for the User's device. <br/> Subscribe the user to their new topic. |
| searchUsers | Query | <b>prefix</b>: String | [[User](#user)] | Get users with name beginning with the <i>prefix</i> |
| addFriend | Mutation | <b>friendID</b>: String! | Boolean | Send friend invite or accept friend invite (if one exists). `true` if user with id of <i>friendID</i> was added, `false` if invite was sent instead. |
| getFriends | Query | - | [[User](#user)] | Get profile of all friends |
| removeFriend | Mutation | <b>friendID</b>: String! | - | Unfriend user with id of <i>friendID</i> |
| inviteToParty | Mutation | <b>memberID</b>: String! | - | Invite user with id of <i>memberID</i> to your current party |
| getInvites | Query | - | [[Invite](#invite)] | Get all party and friend invitations |
| acceptPartyinvite | Mutation | <b>inviterID</b>: String! | [[User](#user)] | Join party you were invited to by the user with id <i>inviterID</i>. Return other members in the party. |
| deleteInvite | Mutation | <b>type</b>: Int (0 = friend, 1 = party)<br/> <b>isOwner</b>: Boolean <br/> <b>userID</b>: String | - | Delete an invite sent to you or an invite you sent to someone else (depends on <i>isOwner</i>) that belongs to <i>type</i> for the <i>userID</i> |
| getPartyMembers | Query | - | [[User](#user)] | Get profiles of all party members |
| leaveParty | Mutation | - | - | Leave the party you are currently in |

## Park Passes

| Endpoint | Method | Params | Return Type | Description |
| -- | -- | -- | -- | -- |
| updatePass | Mutation | <b>passID</b>: String! <br/> <b>isPrimary</b>: Boolean <br/> <b>isEnabled</b>: Boolean | [UserPass](#userpass) |  Add or update park pass with <i>passID</i> to the user if its a valid passID.  If <i>primary</i> show it first, if <i>enabled</i> its visible to the party |
| getUserPasses | Query | <b>userID</b>: String | [[UserPasses](#userpasses)] | Get park passes and profile of user with <i>userID</i>. Only allowed if user is your friend or in your party. |
| removePass | Mutation | <b>passID</b>: String! | - | Remove pass with <i>passID</i> belonging to the user |
| getFriendPasses | Query | - | [[UserPasses](#userpasses)] | Get all park passes for friends |
| syncPasses | Mutation | <b>passID</b>: String | - | All passes will be added to an official Disney app user who owns a pass with id <i>passID</i>.  Used to easily order the MaxPass from the official app. |
| getPartyPasses | Query | - | [PassGroup](#passgroup) | Get park passes and profiles of all party members. Also, send splitters (users that want to split the pass view with you) |
| updateSplitters | Mutation | <b>groupID</b>: String! ("party") <br /> <b>action</b>: String! ("split", "unsplit", "merge") | [SplitterUpdate](#spiltterupdate) | The <i>groupID</i> specifies a group <u>within a party</u> that will determine how park passes are split between users. The <i>action</i> determines how that group is modified |
| subUpdateSplitters | Subscription | <b>groupID</b>: String! | [SplitterUpdate](#splitterupdate) | Subscribe to changes to the users splitting the pass group of id <i>groupID</i> |
| refreshPasses | Mutation | - | - | Update each park pass in the party with data from Disney's API (used to update MaxPass status) |

## Fast Passes

| Endpoint | Method | Params | Return Type | Description |
| -- | -- | -- | -- | -- |
| updatePlannedFpTransactions | Mutation | <b>plannedTransactions</b>: [[PlannedFpTransactionIn](#plannedfptransactionin)] | [FastPassData](#fastpassdata) | Update the party's planned FastPasses to the provided |
| getFastPasses | Query | - | [FastPassData](#fastpassdata) | Get planned and scheduled FastPasses for all party members |

# Data Types

## Attractions (Rides + Resort)

### Ride
Represents an attraction with varying wait times
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String! | ID for attraction from Disney |
| info | AttractionInfo | Consistent information of attraction |
| time | RideTime | Current status of ride |

### Event
Represents park event with showtimes (ex. Fantasmic)
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String! | ID for attraction from Disney |
| info | AttractionInfo | Consistent information of attraction |
| dateTimes | [String] | The dateTimes the event is showing today in format "YYYY-MM-DD HH:mm:ss" |

### AttractionInfo
Information of attraction that isn't updated often
| PropertyName | Type | Description |
| -- | -- | -- |
| name | String | Display name, can be set by user |
| officialName | String | Attraction name provided by Disney |
| picUrl | String | url for ride's thumbnail |
| officialPicUrl | String | Ride thumbnail provided by Disney |
| land | String | The land within the park the attraction is located |
| height | String | Minimum height to ride attraction |
| labels | String | List of properties for the ride |
| customPicUrls | [String] | List of urls for pictures of the ride from the user and Disney |

### RideTime
Data that constantly changes for a ride with a monitored queue
| PropertyName | Type | Description |
| -- | -- | -- |
| status | String | Availability of ride ( "Operating", "Down", "Closed", "Operates Seasonally") |
| waitTime | Int | Estimated # of minutes guest must spend in queue (from Disney) |
| fastPassTime | String | The datetime a FastPass could be redeemed if aquired now ("2019-02-09T19:30:00.000Z") |
| waitRating | Float | Rates how good the current wait time is using predictions, ranges from 0-10 with 10 being the best wait time |
| changedTime | String | The last time Disney changed the wait time or status of the ride ("2019-02-09T19:30:00.000Z") |
| changedRange | String | The maximum time the change went without updating (00:05:00 = 5 mins without updating) |

### RideDataPoints
The varying data for a ride on a date
| PropertyName | Type | Description |
| -- | -- | -- |
| rideID | String | ID of the ride the data is for |
| rideName | String | Custom or official name of ride |
| ridePicUrl | String | url for ride's thumbnail |
| rideOfficialPicUrl | String | Ride thumbnail provided by Disney |
| rideOpenDateTime | String | The dateTime the ride opened ("2019-02-09T19:30:00.000Z") |
| rideCloseDateTime | String | The dateTime the ride closes ("2019-02-09T19:30:00.000Z") |
| rideLabels | String | List of properties for the ride |
| dps | [RideDataPoint] | Predictions and historical data for wait times & FastPasses on this date |

### RideDataPoint
The predicted and historical queue data at a given dateTime
| PropertyName | Type | Description |
| -- | -- | -- |
| prediction | RidePredictDataPoint | The predicted waitMins & fastPassTime at given dateTime |
| history | RideHistoricalDataPoint | The historical waitMins,fastPassTime, and status at that time |
| waitMins | Float | The # of minutes to wait for the ride at the DateTime (will be history but falls back to prediction) |
| fastPassTime | String | The fastPassTimeat the dateTime in format YYYY-MM-DD HH:mm:ss (will be history but falls back to prediction) |
| dateTime | String | The dateTime for the values in "YYYY-MM-DD HH:mm:ss" format |

### RidePredictDataPoint
Contains predicted ride queue data
| PropertyName | Type | Description |
| -- | -- | -- |
| waitMins | Float | The predicted # of minutes to wait |
| fastPassTime | String | The predicted time the FastPasses will be for |

### RideHistoricalDataPoint
Contains historical ride queue data
| PropertyName | Type | Description |
| -- | -- | -- |
| waitMins | Float | The historical # of minutes to wait |
| fastPassTime | String | The historical fastPassTime |
| status | String | Availability of ride ( "Operating", "Down", "Closed", "Operates Seasonally") |

### Pic
Image data that indicates if it needs to be uploaded
| PropertyName | Type | Description |
| -- | -- | -- |
| url | String | The uri encoded image OR the url pointing to the image (ex. "data:image/gif;base64,R0l...") |
| added | Boolean | Indicates if the image has to be uploaded. url must be a uri encoded image if this is true. |

### Filter
A named list of attractions that can be displayed or watched
| PropertyName | Type | Description |
| -- | -- | -- |
| name | String | The name & unique ID of the filter |
| attractionIDs | [String] | IDs for ride or events that belong to the filter |
| type | String | Specifies the type of attraction this filter is for ("event" or "ride") |
| watchConfig | WatchConfig | If defined, the attractions will be monitored for changes and, if parameters in watchConfig are met, the user will be notified |

### WatchConfig
Users can get notifications if parameters in this configuration are met
| PropertyName | Type | Description |
| -- | -- | -- |
| waitTime | Int | If # of minutes the queue wait is >= this value, send notification (if null ignore)  |
| waitRating | Float | If waitRating is >= this value, send notification (if null ignore) |
| fastPassTime | DateTime | If fastPasses are now available >= this time, send notification (if null ignore) |

### ParkSchedule
Information on park hours & other info for a date
| PropertyName | Type | Description |
| -- | -- | -- |
| parkName | String | The name of the park the schedule is for |
| parkIconUrl | String | The location of the image for the icon of the park |
| blockLevel | Int | Indicates what tier of annual passes are blocked from park entry (the higher, the more exclusive) |
| crowdLevel | Int | The estimated crowd for the date ranges from 0-5, 5 being max crowds |
| openTime | String | The time the park opens in format HH:mm:ss |
| closeTime | String | The time the park closes in format HH:mm:ss |
| magicStartTime | String | The time magic hours start in format HH:mm:ss |
| magicEndTime | String | The time magic hours stop in format HH:mm:ss |
| date | String | The date the schedule is for in YYYY-MM-DD |

### Weather
Information about weather (forecast or historical) at a dateTime
| PropertyName | Type | Description |
| -- | -- | -- |
| dateTime | String | The dateTime the weather is for |
| rainStatus | Int | The magnitude of the rain (0-5) |
| feelsLikeF | Int | The apparent temperature in fahrenheit |

## Users

### User
The basic profile for a user
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String | The id of the user (AWS Cognition id) |
| name | String | The customizable display name of the user |
| profilePicUrl | String | Url points to profile picture of this user |

### VerifySnsResult
Data about the Sns subscription of the user
| PropertyName | Type | Description |
| -- | -- | -- |
| endpointArn | String | The identifier for the endpoint of the user's device |
| subscriptionArn | String | The identifier for the endpoint's subscription to the user's topic |

### Invite
A party of friend invitation from one user to another
| PropertyName | Type | Description |
| -- | -- | -- |
| isOwner | Boolean | This user created the invite |
| isFriend | Boolean | The other user is already a friend |
| type | Int | Indicates if a party or friend invitation (0 is friend, 1 is party) |
| user | User | Other user that sent or received the invite |

## Park Passes

### Pass
An annual or day pass for admission and some data linked with it
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String! | The unique id for the park pass (provided by Disney) |
| name | String | The name of the person the pass belongs to |
| type | String | The tier of the pass (SoCal Annual, Deluxe, etc.) |
| expirationDT | String | The dateTime the pass expires on |
| isPrimary | Boolean | Indicates if the app user is the direct owner of this pass (its not just their kid's) |
| isEnabled | Boolean | Determines if party can see this pass, hiding helps with scanning passes |
| hasMaxPass | Boolean | Indicates if the user has bought the MaxPass for today |

### UserPass
A user paired with one the passes they own
| PropertyName | Type | Description |
| -- | -- | -- |
| user | User | The user that owns the pass |
| pass | Pass | The park pass |

### UserPasses
The passes that belong to a user and the user's profile
| PropertyName | Type | Description |
| -- | -- | -- |
| user | User | The user that owns the pass |
| passes | [Pass] | The passes owned by the user |

### PassGroup
A group within a party that can divide passes between users (for easier scan-in)
| PropertyName | Type | Description |
| -- | -- | -- |
| userPasses | [UserPasses] | List passes that belong to the group with their user |
| splitters | [String] | The userIDs of users that are splitting the pass view |

### SplitterUpdate
Describes an update that occured to the splitters for a group
| PropertyName | Type | Description |
| -- | -- | -- |
| groupID | String | The id of the group where the splitters changed ("party") |
| splitters | [String] | The userIDs of users that are splitting the pass view |

## Fast Passes

### PlannedFpTransactionIn
Input to queue a FastPass order (what ride, users, order in the queue, etc.)
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String | Unique ID for the FastPass transaction |
| rideID | String | The ID of the ride the FastPass is for |
| passes | [PlannedFpPassIn] | The park passes getting the FastPass and the priority the pass is for them |

### PlannedFpPassIn
The park pass to get the FastPass for and what priority it is in the queue
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String | A park pass ID |
| priority | Int | Where the order is in the FastPass queue (0 is highest priority) |

### PlannedFpTransaction
Describes a queued FastPass order (what ride, users, order in the queue, etc.)
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String | Unique ID for the FastPass transaction |
| attractionID | String | The ID of the attraction the FastPass is for |
| attractionName | String | The display name of the attraction |
| attractionPicUrl | String | The url of the thumbnail for the attraction |
| attractionOfficialPicUrl | String | The url for Disney's thumbnail for the attraction |
| selectionDateTime | String | The dateTime (or predicted dateTime) the FastPass can be ordered - format "YYYY-MM-DD HH:mm:ss" |
| fastPassTime | String | The dateTime (or predicted dateTime) the FastPass can be redeemed - format "YYYY-MM-DD HH:mm:ss" |
| passes | [PlannedFpPass] | The park passes getting the FastPass and the priority the pass is for them |

### PlannedFpPass
The park pass to get the FastPass for and what priority it is in the queue
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String | A park pass ID |
| priority | Int | Where the order is in the FastPass queue (0 is highest priority) |
| nextSelectionDateTime | String | The next, minimum dateTime the user will be able to get another FastPass - format "YYYY-MM-DD HH:mm:ss" |

### FastPassData
Contains data for all FastPasses and planned FastPasses for the user's party
| PropertyName | Type | Description |
| -- | -- | -- |
| transactions | [FpTransaction] | A park pass ID |
| priority | Int | Where the order is in the FastPass queue (0 is highest priority) |

## FpTransaction
Describes a group of ordered Fastpass near the same time & for the same ride
| PropertyName | Type | Description |
| -- | -- | -- |
| attractionID | String | The ID of the attraction the FastPass is for |
| attractionName | String | The display name of the attraction |
| attractionPicUrl | String | The url of the thumbnail for the attraction |
| attractionOfficialPicUrl | String | The url for Disney's thumbnail for the attraction |
| startDateTime | String | The dateTime the FastPass can be redeemed - format "YYYY-MM-DD HH:mm:ss" |
| endDateTime | String | The dateTime the FastPass can no longer be redeemed - format "YYYY-MM-DD HH:mm:ss" |
| passes | [FpPass] | The park passes who have the FastPass |

### FpPass
Describes one ordered FastPass for a pass
| PropertyName | Type | Description |
| -- | -- | -- |
| id | String | The id of the park pass that owns the Fastpass |
| startDateTime | String | The dateTime the FastPass can be redeemed - format "YYYY-MM-DD HH:mm:ss" |
| endDateTime | String | The dateTime the FastPass can no longer be redeemed - format "YYYY-MM-DD HH:mm:ss" |


# Cron Jobs

| JobName | RunsEvery | Description |
| -- | -- | -- |
| addRides | 5 days | Scrapes data from Disney's website to populate data with new rides |
| addSchedules | 5 days | Scrapes data from Disney's calendar to populate park schedules |
| addForecasts | 2 hours | Updates forecasts using DarkSky |
| addHistoricalRideTimes | 30 minutes | Adds wait times & FastPasses to database |
| pollUpdates | 2 minutes | If watching filters, check for alerts |

## Other
<b>updateLatestRideTimes</b> is triggered when the user requests the most up-to-date wait times from the API and we want to save those values to the database