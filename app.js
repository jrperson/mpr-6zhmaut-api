const express = require("express")
const morgan = require("morgan")
const bodyParser = require("body-parser")
const async = require("async")
const puppeteer = require('puppeteer')

const app = express()

const SerialPort = require("serialport")
const Readline = require('@serialport/parser-readline')

const REQUERY = /^true$/i.test(process.env.REQUERY)
const CORS = /^true$/i.test(process.env.CORS)
const AMPCOUNT = process.env.AMPCOUNT || 1
const BAUDRATE = parseInt(process.env.BAUDRATE || 9600)
const LOGFORMAT = `'[:date[iso]] - :remote-addr - :method :url :status :response-time ms - :res[content-length]b'`
const DEVICE = process.env.DEVICE || "/dev/ttyUSB0"

const attributeMap = {
	pa: 'pa',
	pr: 'pr',
	power: 'pr',
	mu: 'mu',
	mute: 'mu',
	vo: 'vo',
	volume: 'vo',
	tr: 'tr',
	treble: 'tr',
	bs: 'bs',
	bass: 'bs',
	bl: 'bl',
	balance: 'bl',
	ch: 'ch',
	channel: 'ch',
	source: 'ch',
	ls: 'ls',
	keypad: 'ls'
}

app.use(morgan(LOGFORMAT))
app.use(bodyParser.text({ type: '*/*' }))

const connection = new SerialPort(DEVICE, { baudRate: BAUDRATE })

const parser = connection.pipe(new Readline({ delimiter: "\n", encoding: "ascii" }))

connection.on("open", () => {
	var zones = {}

	const queryControllers = async () => {
		for (let i = 1; i <= AMPCOUNT; i++) {
			connection.write(`?${i}0\r`)
			await async.until(
				callback => { callback(null, !!zones && Object.keys(zones).length === (6 * i)) },
				callback => { setTimeout(callback, 10) }
			)
		}
	}

	connection.write("?10\r")
	AMPCOUNT >= 2 && connection.write("?20\r")
	AMPCOUNT >= 3 && connection.write("?30\r")

	CORS && app.use((req, res, next) => {
		res.header("Access-Control-Allow-Origin", "*")

		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
		next()
	})

	parser.on('data', data => {
		console.log(data)
		const zone = data.toString("ascii").match(/#>(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
		if (zone != null) {
			zones[zone[1]] = {
				"zone": zone[1],
				"pa": zone[2],
				"pr": zone[3],
				"mu": zone[4],
				"dt": zone[5],
				"vo": zone[6],
				"tr": zone[7],
				"bs": zone[8],
				"bl": zone[9],
				"ch": zone[10],
				"ls": zone[11]
			}
		}
	})

	// Only allow query and control of single zones
	app.param('zone', (req, res, next, zone) => {
		if (zone % 10 > 0 && !isNaN(zone)) {
			req.zone = zone
			next()
		} else res.status(500).send({ error: zone + ' is not a valid zone' })
	})

	// Validate and standarize control attributes
	app.param('attribute', (req, res, next, attribute) => {
		if (typeof attribute !== 'string') res.status(500).send({ error: attribute + ' is not a valid zone control attribute' })
		if (attribute.length > 2) req.attribute = attributeMap[attribute.toLowerCase()]
		if (!!req.attribute) res.status(500).send({ error: attribute + ' is not a valid zone control attribute' })
		next()
	})


	app.get('/zones', (req, res) => {
		const zoneCount = Object.keys(zones).length
		if (REQUERY) {
			zones = {}
			queryControllers()
		}
		async.until(
			callback => { callback(null, !!zones && Object.keys(zones).length === zoneCount) },
			callback => { setTimeout(callback, 10) },
			() => {
				var zoneArray = []
				for (var o in zones) {
					zoneArray.push(zones[o])
				}
				res.json(zoneArray)
			}
		)
	})

	app.get('/zones/:zone', (req, res) => {
		if (REQUERY) {
			zones = {}
			queryControllers()
		}
		async.until(
			callback => { callback(null, !!zones[req.zone]) },
			callback => { setTimeout(callback, 10) },
			() => { res.json(zones[req.zone]) }
		)
	})

	app.get('/zones/:zone/:attribute', (req, res) => {
		zones = {}
		queryControllers()
		async.until(
			callback => { callback(null, !!zones[req.zone]) },
			callback => { setTimeout(callback, 10) },
			() => { res.send(zones[req.zone][req.attribute]) }
		)
	})

	app.post('/zones/:zone/:attribute', (req, res) => {
		zones = {}

		(async () => {
			connection.write(`<${req.zone}${req.attribute}${req.body}\r`)
			await async.until(
				callback => { callback(null, !!zones && Object.keys(zones).length === 1) },
				callback => { setTimeout(callback, 10) }
			)
		})()

		queryControllers()
		
		async.until(
			callback => { callback(null, !!zones[req.zone]) },
			callback => { setTimeout(callback, 10) },
			() => { res.json(zones[req.zone]) }
		)
	})

	app.listen(process.env.PORT || 8181)
})
