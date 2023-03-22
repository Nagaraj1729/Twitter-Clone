const express = require("express");
const {open} = require("sqlite");
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const dbPath = path.join(__dirname, "twitterClone.db");
const app =express()
app.use(express.json());

let db = null;
const initializeDBAndServer = async ()=> {
    try{
        db = await open({
                filename : dbPath,
                driver : sqlite3.Database
        });

        app.listen(3000, ()=>{
            console.log("Server Running at http://localhost:3000/");
        });
    }catch(error){
        console.log(`DB Error - ${error.message}`);
        process.exit(1);
    }
};

initializeDBAndServer();

//Authenticate User middleware function
const authenticateUser = (request, response, next)=> {
    const authHead = request.headers.authorization;
    if (authHead === undefined){
        response.status(401);
        response.send("Invalid JWT Token");
    }else{
        const jwtToken = authHead.split(" ")[1]
        //console.log(jwtToken)//-----------------
        jwt.verify(jwtToken, "SECRET_TKN", (error, payload)=> {
            if (error){
                response.status(401);
                response.send("Invalid JWT Token");
            }else{
                request.payload = payload;
                //console.log(request.payload)
                next();
            }
        });      
    }
}

// 1. Register User API
app.post("/register/", async (request, response)=> {
    const {username, password, name, gender} = request.body;
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
    const dbUser = await db.get(selectUserQuery);
    if (dbUser === undefined){
        if (password.length < 6){
            response.status(400);
            response.send("Password is too short")
        }else{
            const hashedPassword = await bcrypt.hash(password, 10);
            const createUserQuery = `
                    INSERT INTO
                        user (name, username, password, gender)
                    VALUES(
                        '${name}', '${username}', '${hashedPassword}', '${gender}'
                    )`
            await db.run(createUserQuery);
            response.status(200);
            response.send("User created successfully")
        } 
    }else{
        response.status(400);
        response.send("User already exists")      
    }    
});

// 2. Login User API
app.post("/login/", async (request, response)=> {
    const {username, password} = request.body;
    const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
    const dbUser = await db.get(selectUserQuery);
    
    if (dbUser === undefined){
        response.status(400);
        response.send("Invalid user")
    }else{
        const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
        if (isPasswordMatched == true){
                const getUserId = `SELECT user_id as userId FROM user WHERE username = '${username}'`
                const {userId} = await db.get(getUserId);
                const payload = {username, userId}
                const jwtToken = jwt.sign(payload, "SECRET_TKN");
                console.log(payload)
                console.log(jwtToken);
                response.send( { jwtToken } );
        }else{
            response.status(400);
            response.send("Invalid password")
        }
    }
});

// 3. Get tweets feed API
app.get("/user/tweets/feed/", authenticateUser, async (request, response)=> {
    const { userId } = request.payload;
     const getTweetsQuery = `
            SELECT 
                username, tweet, date_time as dateTime
            FROM
                tweet NATURAL JOIN user
            WHERE
                user_id IN (
                    SELECT 
                        following_user_id 
                    FROM 
                        follower
                    WHERE 
                        follower_user_id = ${userId}
                )
            ORDER BY
                date_time DESC                
            LIMIT 
                4
        `
    const tweets = await db.all(getTweetsQuery);
    response.send(tweets);
});

// 4. Get following users API
app.get("/user/following/", authenticateUser, async (request, response)=> {
    const {userId} = request.payload;
    const getFollowingUsersQuery = `
            SELECT name
            FROM user
            WHERE
                user_id IN (
                    SELECT 
                        following_user_id 
                    FROM 
                        follower
                    WHERE 
                        follower_user_id = ${userId}
                )
        `
    const following = await db.all(getFollowingUsersQuery);
    response.send(following);
});

//5. Get followers API
app.get("/user/followers/", authenticateUser, async (request, response)=> {
    const {userId} = request.payload; 
    const getFollowersQuery = `
            SELECT name
            FROM user
            WHERE user_id IN (
                    SELECT 
                        follower_user_id 
                    FROM 
                        follower
                    WHERE 
                        following_user_id = ${userId}
                )            
        `
    const followers = await db.all(getFollowersQuery);
    response.send(followers);
});

// 6. Get tweets by Id API
app.get("/tweets/:tweetId/", authenticateUser, async (request, response)=> {
    const {userId} = request.payload;
    const {tweetId} = request.params
    const getTweetQuery = `
            SELECT
                tweet_like.tweet as tweet,
                COUNT (DISTINCT tweet_like.like_id) as likes,
                COUNT (DISTINCT reply_id) as replies,
                tweet_like.date_time as dateTime
            FROM (tweet INNER JOIN like 
                  ON tweet.tweet_id = like.tweet_id) AS tweet_like
                INNER JOIN  reply ON reply.tweet_id = tweet_like.tweet_id
            WHERE 
                tweet_like.tweet_id = ${tweetId}
                AND tweet_like.tweet_id IN (
                        SELECT tweet_id
                        FROM tweet INNER JOIN follower
                             ON tweet.user_id = follower.following_user_id
                        WHERE
                            follower_user_id = ${userId}
                )

        `
    const tweetDetails = await db.get(getTweetQuery);
     if (tweetDetails.tweet === null){
        response.status(401);
        response.send("Invalid Request");
    }else{
         response.send(tweetDetails);
    }
   
});

// 7. Get liked users for a specific tweet API
app.get("/tweets/:tweetId/likes/", authenticateUser, async (request, response)=> {
    const {userId} = request.payload;
    const {tweetId} = request.params
    const getTweetQuery = `
            SELECT
                username
            FROM like NATURAL JOIN user
            WHERE 
                tweet_id = ${tweetId}
                AND tweet_id IN (
                        SELECT tweet_id
                        FROM tweet INNER JOIN follower ON user_id = following_user_id
                        WHERE
                            follower_user_id = 4
                )

        `
    const likedUsers = await db.all(getTweetQuery);    
   if (likedUsers.length === 0){
        response.status(401);
        response.send("Invalid Request");
    }else{
         const names = likedUsers.map(userObj=> userObj.username)
         response.send({likes : names});
    }
   
});

// 8. Get Replies for a specific tweet API
app.get("/tweets/:tweetId/replies/", authenticateUser, async (request, response)=> {
    const {userId} = request.payload;
    const {tweetId} = request.params;
    const getRepliesQuery = `
            SELECT name, reply
            FROM reply NATURAL JOIN user
            WHERE 
                tweet_id = ${tweetId} 
                AND tweet_id IN (
                        SELECT tweet_id
                        FROM tweet INNER JOIN follower ON user_id = following_user_id
                        WHERE
                            follower_user_id = ${userId}
                )

        `
    const replies = await db.all(getRepliesQuery);
    if (replies.length === 0){
        response.status(401);
        response.send("Invalid Request");
    }else{
        response.send({replies});
    }
});

// 9. Get all tweets of user API
app.get("/user/tweets/", authenticateUser, async (request, response)=> {
    const {userId} = request.payload;
    const getALlTweetsByUserQuery = `
            SELECT 
                tweet_like.tweet,
                COUNT(DISTINCT like_id) as likes,
                COUNT(DISTINCT reply_id) as replies,
                tweet_like.date_time as dateTime
            FROM 
                (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) as tweet_like
                 INNER JOIN reply ON reply.tweet_id = tweet_like.tweet_id
            WHERE
                tweet.user_id = ${userId}
            GROUP BY tweet_like.tweet_id
        ` 
    const tweets = await db.all(getALlTweetsByUserQuery);
    response.send(tweets);
});

// 10. Post a tweet API
app.post("/user/tweets/", authenticateUser, async (request, response)=> {
    const {tweet} = request.body;
    const {userId} = request.payload
    const postTweetQuery = `
            INSERT INTO
                tweet (tweet,user_id)
            VALUES (
                '${tweet}',
                ${userId}
            )

        `
    const dbResponse = await db.run(postTweetQuery);
    response.send("Created a Tweet")  
});

// 11. Delete tweet API
app.delete("/tweets/:tweetId", authenticateUser, async (request, response)=> {
    const {tweetId} = request.params;
    const {userId} = request.payload
    const deleteTweetQuery = `
            DELETE FROM tweet
            WHERE
                tweet_id = ${tweetId} AND
                tweet_id IN (
                    SELECT tweet_id FROM tweet WHERE user_id = ${userId}
                )
        `
    const dbResponse = await db.run(deleteTweetQuery);
    if (dbResponse.changes === 0){
        response.status(401);
        response.send("Invalid Request")        
    }else{
        response.send("Tweet Removed")
    }
    
})

module.exports = app;
