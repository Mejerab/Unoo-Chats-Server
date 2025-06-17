const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const cors = require('cors')
const jwt = require('jsonwebtoken');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');
app.use(cors({
    origin: '*' 
    // [
    //     'http://localhost:5173',
    //     'https://unoo-chats-ac24a.web.app',
    //     'https://unoo-chats-ac24a.firebaseapp.com'
    // ]
    , credentials: true
}))
app.use(express.json())
app.use(cookieParser())

const server = app.listen(port);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', "PATCH"],
        credentials: true
    }
});
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xegw8vb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Middleware
const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized Access' });
    }
    jwt.verify(token, process.env.TOKEN_SECRET, (err, decode) => {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        req.decode = decode;
        next();
    })
}

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
}

const userCollection = client.db('unoo').collection('users');
const chatCollection = client.db('unoo').collection('chats');

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        // JWT

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: '7d' });
            res.cookie('token', token, cookieOptions).send({ success: true });
        })
        app.post('/logout', (req, res) => {
            console.log('nothing');
            res.clearCookie('token', { ...cookieOptions, maxAge: 0 }).send({ condition: 'logged out' });
        })

        // Chats

        app.get('/chats', async (req, res) => {
            const result = await chatCollection.find().toArray();
            res.send(result);
        })
        app.get('/chats/source/:source', verifyToken, async (req, res) => {
            const { email } = req.query;
            if (req?.decode?.email !== email) {
                res.status(403).send({ message: 'Forbidden Access' })
            }
            const source = req.params.source;
            const process = await chatCollection.find({ source }).sort({ _id: -1 }).limit(20).toArray();
            const result = process.reverse()
            res.send(result);
        })
        app.patch('/chats/edit/:chat_id', verifyToken, async (req, res) => {
            const { email } = req.query;
            if (req?.decode?.email !== email) {
                res.status(403).send({ message: 'Forbidden Access' })
            }
            const chat_id = req.params.chat_id;
            const data = req.body;
            const filter = { chat_id };
            const updateDoc = {
                $set: {
                    ...data
                }
            }
            const options = { upsert: true };
            const result = await chatCollection.updateOne(filter, updateDoc, options);
            res.send(result)
            io.emit('updatedChats', data);
        })
        app.patch('/chats/delete/:id', verifyToken, async (req, res) => {
            const { email } = req.query;
            if (req?.decode?.email !== email) {
                res.status(403).send({ message: 'Forbidden Access' })
            }
            const chat_id = req.params.id;
            const data = req.body;
            const filter = { chat_id };
            const updateDoc = {
                $set: {
                    ...data
                }
            }
            const options = { upsert: true };
            const result = await chatCollection.updateOne(filter, updateDoc, options);
            res.send(result);
            io.emit('chatDelete', { ...data, chat_id });
        })
        app.delete('/chats', async (req, res) => {
            const result = await chatCollection.deleteMany();
            res.send(result);
        })

        io.on('connection', async (socket) => {
            // console.log('Connected');
            socket.on('chats', async (data) => {
                const text = { ...data, chat_id: uuid() }
                io.emit('chats', text);
                try {
                    await chatCollection.insertOne(text);
                } catch (err) {
                    console.log('Error', err);
                }
            })
            const userId = socket.handshake.query.uid;
            if (!userId) {
                console.log('Id not provided');
                return;
            }
            try {
                socket.broadcast.emit('userOnline', userId);
                await userCollection.updateOne({ uid: userId }, { $set: { online: true, lastOnline: null } });
            } catch (error) {
                console.log('error', error);
            }
            socket.on('logoutUser', async (data) => {
                try {
                    socket.broadcast.emit('userOffline', userId);
                    await userCollection.updateOne({ uid: data }, { $set: { online: false, lastOnline: new Date() } });
                    socket.disconnect();
                } catch (error) {
                    console.log('error', error);
                }
            })
            socket.on('disconnect', async () => {
                try {
                    socket.broadcast.emit('userOffline', userId);
                    await userCollection.updateOne({ uid: userId }, { $set: { online: false, lastOnline: new Date() } });
                } catch (err) {
                    console.log(err);
                }
            })
        })

        // Users
        app.post('/users', async (req, res) => {
            const data = req.body;
            const result = await userCollection.insertOne(data);
            res.send(result);
        })
        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })
        app.get('/users/uid/:uid', async (req, res) => {
            const uid = req.params.uid;
            const result = await userCollection.findOne({ uid });
            res.send(result);
        })
        app.patch('/users/patch/:id', async (req, res) => {
            const id = req.params.id;
            const data = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    ...data
                }
            }
            const options = { upsert: true };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })
        app.get('/users/id/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.findOne(query);
            res.send(result);
        })
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const result = await userCollection.findOne(query);
            res.send(result);
        })

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}

run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Unoo is running.');
})

// app.listen(port, () => {
//     console.log('Server is Alright');
// })
app.listen(port, () => {
    console.log('Server is running');

})