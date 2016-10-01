export = JsSIP;

declare namespace JsSIP {
    class WebSocketInterface {
        constructor(url: string);
        via_transport: string;
    }

    class UA {
        constructor(config: any);
    }
}

