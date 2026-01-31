declare function fetch(input: any, init?: any): Promise<any>;
declare interface RequestInit {
  method?: string;
  headers?: any;
  body?: any;
}
declare interface Response {
  ok: boolean;
  json(): Promise<any>;
  text(): Promise<string>;
}
