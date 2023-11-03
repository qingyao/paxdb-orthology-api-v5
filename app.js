const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const favicon = require('serve-favicon');
const protein = require('./protein');
const backend = require('./db')
const port = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname,'views'));
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(cors());

app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {  // 'finish' event is emitted when a response is sent
        const duration = Date.now() - start;
        console.log(`Processed ${req.method} ${req.originalUrl} in ${duration}ms`);
    });
    
    next();
});

app.get('/', (req, res) => {
    const types = req.accepts(['json','html']);
    if (types == 'html'){
        res.render('index', { title: 'pax-db.org API::Orthologous groups' })
    } else if (types == 'json'){
        res.send({Hello: 'World!'})
    } else {
        res.status(406).send('Not acceptable')
    }
  
})

app.listen(port, () => {
  console.log(`PaxDb ortholog API listening on port ${port}`)
});

app.use ('/protein', protein);

//docker bridge instead of localhost, other container's IP found by docker inspect |grep IPAddress
// const NEO4J_URL ='bolt://$ip:7687';
// const NEO4J_USER ='neo4j';
// const NEO4J_PASS = 'neo4j'

const db = backend(process.env.NEO4J_URL,process.env.NEO4J_USER,process.env.NEO4J_PASS);
app.set('db', db);