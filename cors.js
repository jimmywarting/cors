import { Readable } from 'node:stream'
import { createServer } from 'node:http'
import { Buffer } from 'node:buffer'
import follow from 'follow-redirects'

const get = follow.http.request
const gets = follow.https.request

function goFetch (req, res, options, responseOptions) {
  const request = options.protocol === 'https:' ? gets : get

  const proxyReq = request(options, (proxyRes) => {
    const responseHeaders = new Headers(proxyRes.headers)

    for (const key of responseOptions.deleteResponseHeaders) {
      responseHeaders.delete(key)
    }

    for (const [key, value] of responseOptions.setResponseHeaders) {
      responseHeaders.set(key, value)
    }

    for (const [key, value] of responseOptions.appendResponseHeaders) {
      responseHeaders.append(key, value)
    }

    if (responseOptions.setStatusCode) {
      res.statusCode = responseOptions.setStatusCode
    }

    if (responseOptions.setStatusMessage) {
      res.statusMessage = responseOptions.setStatusMessage
    }

    res.writeHead(
      proxyRes.statusCode,
      proxyReq.statusMessage,
      Object.fromEntries(responseHeaders)
    )
    proxyRes.pipe(res, { end: true })
  })

  proxyReq.on('error', (err) => {
    console.error(err)
    res.end('')
  })

  req.pipe(proxyReq, { end: true })
}

const server = createServer((req, res) => {
  const protocol = req.socket.encrypted ? 'https' : 'http'
  const clientsHeaders = new Headers(req.headers)
  const clientsMethod = req.method
  const clientsUrl = new URL(`${protocol}://${req.headers.host}${req.url}`)

  let requestInfo = {}

  if (clientsUrl.searchParams.has('cors')) {
    requestInfo = JSON.parse(clientsUrl.searchParams.get('cors'))
  } else if (clientsHeaders.has('referer')) {
    let referer = clientsHeaders.get('referer')
    const cors = new URL(referer).searchParams.get('cors')
    if (cors === null) {
      res.statusCode = 403
      res.end('No CORS configuration found')
      return
    }
    const config = JSON.parse(cors)
    const url = new URL(req.url, config.url) + ''
    requestInfo = { url }
  } else {
    res.statusCode = 403
    res.end('No CORS configuration found')
    return
  }

  const {
    method = req.method,
    url,
    body,
    followRedirect = true,
    forwardRequestHeaders = true,
    forwardIpAddress = true,
    deleteRequestHeaders = [],
    ignoreRequestHeaders = false,
    deleteResponseHeaders = [],
    setStatusCode = undefined,
    appendResponseHeaders = [],

    setRequestHeaders = [],
    setResponseHeaders = [],
    appendRequestHeaders = [],
  } = requestInfo

  let targetUrl = new URL(url)
  let requestHeaders = new Headers()

  res.setHeader('access-control-allow-origin', clientsHeaders.get('origin') || '*')

  // Access-Control-Request-Private-Network: true
  for (let [key, value] of clientsHeaders) {
    key = key.toLowerCase()
    if (key.startsWith('access-control-request-')) {
      console.log('Request:', key, value)
      res.setHeader(key.replace('request', 'allow'), value)
    }
  }


  // 1.1 Forwards all request headers made by the browser.
  if (forwardRequestHeaders) {
    for (let [key, value] of clientsHeaders) {
      // Remove x-cors- prefix that are needed by forbidden request headers
      key = key.replace('x-cors-', '')
      requestHeaders.append(key, value)
    }
  }

  if (ignoreRequestHeaders) {
    for (let header of requestHeaders.keys()) {
      requestHeaders.delete(header)
    }
  }

  // 1.2 Forwards the client's IP address.
  if (forwardIpAddress) {
    requestHeaders.append('x-forwarded-for', req.socket.remoteAddress)
  }

  // 1.3 Delete unwanted request headers sent by the browser.
  for (const header of deleteRequestHeaders) {
    requestHeaders.delete(header)
  }

  // 1.4 Append all or extra request headers to the request.
  for (const [key, value] of appendRequestHeaders) {
    requestHeaders.append(key, value)
  }

  // 1.5 Set request headers (will overwrite any existing headers).
  for (const [key, value] of setRequestHeaders) {
    requestHeaders.set(key, value)
  }

  requestHeaders.set('host', targetUrl.host)

  // 1.6 Forward the request body.
  let requestBody = body ? Readable.from([Buffer.from(body)]) : req

  const requestOptions = {
    method,
    headers: Object.fromEntries(requestHeaders),
    host: targetUrl.host,
    followRedirects: followRedirect,
    path: targetUrl.pathname,
  }

  const responseOptions = {
    deleteResponseHeaders,
    appendResponseHeaders,
    setResponseHeaders,
    setStatusCode,
  }

  goFetch(requestBody, res, requestOptions, responseOptions)
}).listen(4444)
