const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
// const { format } = require("date-fns");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let database;

const InitializeDatabaseAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000");
    });
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
};

InitializeDatabaseAndServer();

//API 1:
//
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user  WHERE username = '${username}';`;
  const dbResponse = await database.get(selectUserQuery);

  if (dbResponse === undefined) {
    if (password.length < 6) {
      // too short
      response.status(400);
      response.send("Password is too short");
    } else {
      // password good
      const addUserQuery = `
        INSERT INTO 
            user(name,username,password,gender)
        VALUES
            ('${name}' ,'${username}','${hashedPassword}','${gender}')`;
      const dbResponse = await database.run(addUserQuery);
      console.log(dbResponse.lastID);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2
//
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user  WHERE username = '${username}';`;
  const dbResponse = await database.get(selectUserQuery);
  if (dbResponse === undefined) {
    //invalid user
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      dbResponse.password
    );
    if (isPasswordMatched === false) {
      // invalid password
      response.status(400);
      response.send("Invalid password");
    } else {
      // return jwt token
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "my_secret_key");
      response.send({ jwtToken });
    }
  }
});

// authenticateToken middleware

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "my_secret_key", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        const selectUserQuery = `SELECT * FROM user WHERE username = "${payload.username}";`;
        const dbResponse = await database.get(selectUserQuery);
        request.login_user_id = dbResponse.user_id;
        next();
      }
    });
  }
};

// API 3
//Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
//follower
//tweet tweet, datetime
// user  user_id of the tweet

// username, tween, dateTime
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { login_user_id } = request;

  const latestTweetsOfPeopleQuery = ` 
    SELECT
        T.username AS username,
        tweet.tweet AS tweet,
        tweet.date_time AS dateTime
    FROM 
        (follower  INNER JOIN  user ON follower.following_user_id = user.user_id) AS T
        INNER JOIN tweet ON T.user_id = tweet.user_id
    WHERE
        T.follower_user_id = ${login_user_id}
    ORDER BY
        tweet.date_time DESC
    LIMIT 4;`;
  const dbResp = await database.all(latestTweetsOfPeopleQuery);
  // take dbResp and convert to respObj and format Date
  response.send(dbResp);
});

//API 4:

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { login_user_id } = request;
  const UserFollowingQuery = `
    SELECT
        user.name AS name
    FROM 
        follower INNER JOIN user ON follower.following_user_id = user.user_id
    WHERE
        follower.follower_user_id = ${login_user_id}`;
  const dbResp = await database.all(UserFollowingQuery);
  response.send(dbResp);
});

// API 5:
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { login_user_id } = request;

  const showFollowersQuery = ` 
      SELECT 
        user.name AS name 
      FROM 
        follower INNER JOIN user ON follower.follower_user_id = user.user_id
      WHERE 
        follower.following_user_id = ${login_user_id};`;
  const dbResp = await database.all(showFollowersQuery);
  response.send(dbResp);
});

//API 6:
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { login_user_id } = request;
  const { tweetId } = request.params;

  const getUserTweet = `
        SELECT
            tweet.tweet AS tweet,
            COUNT(DISTINCT like.like_id) AS likes,
            COUNT(DISTINCT reply.reply_id) AS replies,
            tweet.date_time AS dateTime
        FROM
            (( follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id ) AS T 
            INNER JOIN like ON tweet.tweet_id = like.tweet_id ) AS H 
            INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
            
        WHERE
            tweet.tweet_id = ${tweetId}
        GROUP BY
            tweet.tweet;`;
  const dbResp = await database.get(getUserTweet);
  if (dbResp === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(dbResp);
  }
});

// API 7:
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { login_user_id } = request;
    const { tweetId } = request.params;

    const selectLikedNames = `
        SELECT 
            user.username AS name
        FROM 
            (( follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id ) AS T 
            INNER JOIN like ON tweet.tweet_id = like.tweet_id ) AS H 
            INNER JOIN user ON like.user_id =  user.user_id
        WHERE 
            follower.follower_user_id = ${login_user_id} AND 
            tweet.tweet_id = ${tweetId};`;
    const dbResponse = await database.all(selectLikedNames);
    if (dbResponse.length === 0) {
      // no Invalid
      response.status(401);
      response.send("Invalid Request");
    } else {
      const listObject = dbResponse.map((obj) => {
        return obj["name"];
      });

      response.send({ likes: listObject });
    }
  }
);

// API 8:
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { login_user_id } = request;
    const { tweetId } = request.params;

    const selectLikedNames = `
        SELECT 
            user.name AS name,
            reply.reply AS reply
        FROM 
            (( follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id ) AS T 
            INNER JOIN reply ON tweet.tweet_id = reply.tweet_id ) AS H 
            INNER JOIN user ON reply.user_id =  user.user_id
        WHERE 
            follower.follower_user_id = ${login_user_id} AND 
            tweet.tweet_id = ${tweetId};`;
    const dbResponse = await database.all(selectLikedNames);
    if (dbResponse.length === 0) {
      // no Invalid
      response.status(401);
      response.send("Invalid Request");
    } else {
      let responseObject = {
        replies: dbResponse,
      };
      //   const listObject = dbResponse.map((obj) => {
      // return obj["name"];
      //   });

      response.send(responseObject);
    }
  }
);

// API 9:

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { login_user_id } = request;

  const getUserTweets = `
        SELECT 
            tweet.tweet AS tweet,
            COUNT(DISTINCT like.like_id) AS likes,
            COUNT(DISTINCT reply.reply_id) AS replies,
            tweet.date_time AS dateTime
        FROM
            (tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id) AS T
            LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE
            tweet.user_id = ${login_user_id}
        GROUP BY
            tweet.tweet_id;`;
  const dbResponse = await database.all(getUserTweets);
  response.send(dbResponse);
});

// API 10

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { login_user_id } = request;
  const { tweet } = request.body;

  const createUserTweet = `
        INSERT INTO 
            tweet(tweet, user_id)
        VALUES
            ('${tweet}', ${login_user_id});`;
  const dbResponse = await database.run(createUserTweet);
  console.log(dbResponse.lastID);
  response.send("Created a Tweet");
});

// API 11

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { login_user_id } = request;
    const { tweetId } = request.params;

    const getTweetQuery = `
        SELECT 
            *
        FROM 
            tweet
        WHERE
            tweet.tweet_id = ${tweetId} AND 
            tweet.user_id = ${login_user_id};`;
    const dbResponse = await database.get(getTweetQuery);
    console.log(dbResponse);
    if (dbResponse === undefined) {
      //invalid
      response.status(401);
      response.send("Invalid Request");
    } else {
      //valid
      const deleteQuery = `
            DELETE FROM 
                tweet
            WHERE
                tweet.tweet_id = ${tweetId} AND 
                tweet.user_id = ${login_user_id};`;
      const dbResp = await database.run(deleteQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
