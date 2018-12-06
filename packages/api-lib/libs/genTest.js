const pump = require('pump')
const request = require('request-promise-native')
const path = require('path')
const Bottleneck = require('bottleneck')
const isUrl = require('is-url')
const util = require('util')
const through2 = require('through2')
const fs = require('fs')
const { Duplex } = require('stream');
process.env.ES_HOST = 'http://192.168.99.100:4571'
const backend = require('./es')

const limiter = new Bottleneck({
  maxConcurrent: 50,
  minTime: 10
})
const limitedRequest = limiter.wrap(request)
const limitedRead = limiter.wrap(util.promisify(fs.readFile))

function streamSink(stream) {
  const transform = through2.obj({ objectMode: true },
    (data, encoding, next) => {
      if (data) {
        next(null, `${data.links[0].href}\n`)
      } else {
        next(null, null)
      }
    })
    stream.pipe(transform)
    .pipe(process.stdout)
}
let count = 0
async function traverse(url, stream, root) {
  count += 1
  try {
    let response
    if (isUrl(url)) {
      response = await limitedRequest(url)
      count -= 1
    } else {
      response = await limitedRead(url)
      count -= 1
    }
    const item = JSON.parse(response)
    const written = stream.write(item)
    if (written) {
      traverseLinks(item, url, stream)
    } else {
      stream.once('drain', () => {
        traverseLinks(item, url, stream)
      })
    }
    if (count === 0 && !root) {
      console.log('completed')
      stream.write('completed')
      //return 'completed'
    }
  } catch (err) {
    console.log(err)
  }
}

function traverseLinks(item, url, stream) {
  const { links } = item
  links.forEach(async (link) => {
    const { rel, href } = link
    if (rel === 'child' || rel === 'item') {
      if (path.isAbsolute(href)) {
        traverse(href, stream)
      } else {
        traverse(`${path.dirname(url)}/${link.href}`, stream)
      }
    }
  })
}
class ItemStream extends Duplex {
  constructor(options) {
    super({
      readableObjectMode : true,
      writableObjectMode: true
    })
    this.items = []
  }
  _write(chunk, encoding, callback) {
    this.items.push(chunk)
    callback()
  }
  _read() {
    const item = this.items.pop()
    if (item === 'completed') {
      this.push(null)
    } else {
      this.push(item)
    }
  }
}

async function processCatalog(url) {
  const duplexStream = new ItemStream()
  const start = await traverse(url, duplexStream, true)
  streamSink(duplexStream)
  //await backend.prepare('collections')
  //await backend.prepare('items')
  //const { toEs, esStream } = await backend.stream()
  //pump(
    //duplexStream,
    //toEs,
    //esStream,
    //(err) => {
      //if (err) {
        //console.log('Error streaming: ', err)
      //} else {
        //console.log('Ingest complete')
      //}
    //})
}
processCatalog('../tests/integration/data/catalog.json')
//processCatalog('https://landsat-stac.s3.amazonaws.com/landsat-8-l1/227/81/catalog.json')

