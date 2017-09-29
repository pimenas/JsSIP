module.exports = Subscription;

var C = {
    // Subscription states
    STATUS_NULL:                0,
    STATUS_SUBSCRIBE_SENT:      1,
    STATUS_SUBSCRIBED:          2,
    STATUS_UNSUBSCRIBE_SENT:    3,
    STATUS_UNSUBSCRIBED:        4,
    STATUS_REQUEST_TIMEOUT:     5,
    STATUS_TRANSPORT_ERROR:     6
};

/**
 * Expose C object.
*/
Subscription.C = C;

var debug = require('debug')('JsSIP:Subscriber');
var JsSIP_C = require('./Constants');
var RequestSender = require('./RequestSender');
var SIPMessage = require('./SIPMessage');
var Utils = require('./Utils');

function Subscription(ua) {
    debug('new()');
    this.ua = ua;
    this.status = C.STATUS_NULL;

    this.subscribers = [];
}

Subscription.prototype.subscribe = function(uri, options) {
    debug('subscribing to ' + uri + ' with options: ', options);

    this.remote_target = uri;
    this.local_tag = Utils.newTag();

    var requestParams = {
        from_tag: this.local_tag
    };

    var extraHeaders = !!options && !!options.extraHeaders ? options.extraHeaders : [];

    var self = this;

    // Set anonymous property
    this.anonymous = options.anonymous || false;

    this.contact = this.ua.contact.toString({
        anonymous: this.anonymous,
        outbound: true
    });

    extraHeaders.push('Contact: ' + this.contact);

    var request = new SIPMessage.OutgoingRequest(JsSIP_C.SUBSCRIBE, uri, this.ua, requestParams, extraHeaders);

    this.request = request;
    this.call_id = request.call_id;
    this.local_seqnum = request.cseq;
    this.remote_target = uri;

    if (!!options && !!options.eventHandlers && !!options.eventHandlers.notify) {
        this.subscribers.push(options.eventHandlers.notify);
    }

    // Save the session into the ua sessions collection.
    this.id = this.call_id + this.local_tag;
    this.ua.sessions[this.id] = this;

    var applicant = {
        method: 'SUBSCRIBE',
        request: request,
        auth: null,
        challenged: false,
        stalled: false,
        receiveResponse: function(response) {
            debug('receiveResponse()', response);
            self.status = C.STATUS_SUBSCRIBED;
            self.local_uri = response.parseHeader('from').uri;
            self.remote_uri = response.parseHeader('to').uri;
            self.remote_tag = response.to_tag;
        },
        onRequestTimeout: function() {
            debug('onRequestTimeout()');
            self.status = C.STATUS_REQUEST_TIMEOUT;
        },
        onTransportError: function() {
            debug('onTransportError()');
            self.status = C.STATUS_TRANSPORT_ERROR;
        }
    };

    var requestSender = new RequestSender(applicant, this.ua);

    this.status = C.STATUS_SUBSCRIBE_SENT;

    requestSender.send();

    return self;
};

Subscription.prototype.receiveRequest = function(request) {
    debug('receiveRequest()');

    var i;

    switch(request.method) {
        case JsSIP_C.NOTIFY:
            if (this.status === C.STATUS_SUBSCRIBED) {
                request.reply(200);
                for (i = 0; i < this.subscribers.length; i++) {
                    this.subscribers[i].call(this, request.body);
                }
            } else {
                request.reply(501);
            }
            break;

        default:
            request.reply(501);
    }
};

Subscription.prototype.unsubscribe = function() {
    if (this.status !== C.STATUS_SUBSCRIBED) {
        throw new Error('You need to be subscribed in order to unsubscribe!');
    }

    var extraHeaders = [
        'Contact: ' + this.contact,
        'Expires: 0'
    ];
    var body;

    var request = new SIPMessage.OutgoingRequest(
        JsSIP_C.SUBSCRIBE,
        this.remote_target,
        this.ua,
        {
            cseq: this.local_seqnum += 1,
            call_id: this.call_id,
            from_uri: this.local_uri,
            from_tag: this.local_tag,
            to_uri: this.remote_uri,
            to_tag: this.remote_tag
        },
        extraHeaders, body
    );

    var self = this;

    var applicant = {
        method: 'SUBSCRIBE',
        request: request,
        auth: null,
        challenged: false,
        stalled: false,
        receiveResponse: function(response) {
            debug('receiveResponse()', response);
            self.status = C.STATUS_UNSUBSCRIBED;
        },
        onRequestTimeout: function() {
            debug('onRequestTimeout()');
            self.status = C.STATUS_REQUEST_TIMEOUT;
        },
        onTransportError: function() {
            debug('onTransportError()');
            self.status = C.STATUS_TRANSPORT_ERROR;
        }
    };

    var requestSender = new RequestSender(applicant, this.ua);

    this.status = C.STATUS_UNSUBSCRIBE_SENT;

    requestSender.send();

    return self;
};
