export namespace app {
	
	export class MatchRecord {
	    id: number;
	    match_key: string;
	    source_files: string[];
	    source_types?: Record<string, string>;
	    data: parser.MatchResult;
	
	    static createFrom(source: any = {}) {
	        return new MatchRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.match_key = source["match_key"];
	        this.source_files = source["source_files"];
	        this.source_types = source["source_types"];
	        this.data = this.convertValues(source["data"], parser.MatchResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TesseractStatus {
	    path: string;
	    found: boolean;
	    version: string;
	    supported: boolean;
	    error: string;
	    default: string;
	
	    static createFrom(source: any = {}) {
	        return new TesseractStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.found = source["found"];
	        this.version = source["version"];
	        this.supported = source["supported"];
	        this.error = source["error"];
	        this.default = source["default"];
	    }
	}
	export class UpdateInfo {
	    checked: boolean;
	    dev_build: boolean;
	    available: boolean;
	    latest: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.checked = source["checked"];
	        this.dev_build = source["dev_build"];
	        this.available = source["available"];
	        this.latest = source["latest"];
	        this.url = source["url"];
	    }
	}

}

export namespace parser {
	
	export class HeroPlay {
	    hero: string;
	    percent_played: number;
	    play_time?: string;
	    stats?: Record<string, number>;
	
	    static createFrom(source: any = {}) {
	        return new HeroPlay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hero = source["hero"];
	        this.percent_played = source["percent_played"];
	        this.play_time = source["play_time"];
	        this.stats = source["stats"];
	    }
	}
	export class HeroSR {
	    hero: string;
	    sr: number;
	    change: number;
	
	    static createFrom(source: any = {}) {
	        return new HeroSR(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hero = source["hero"];
	        this.sr = source["sr"];
	        this.change = source["change"];
	    }
	}
	export class PerformanceStat {
	    total: number;
	    avg_per_10min?: number;
	
	    static createFrom(source: any = {}) {
	        return new PerformanceStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.avg_per_10min = source["avg_per_10min"];
	    }
	}
	export class Performance {
	    eliminations: PerformanceStat;
	    assists: PerformanceStat;
	    deaths: PerformanceStat;
	
	    static createFrom(source: any = {}) {
	        return new Performance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.eliminations = this.convertValues(source["eliminations"], PerformanceStat);
	        this.assists = this.convertValues(source["assists"], PerformanceStat);
	        this.deaths = this.convertValues(source["deaths"], PerformanceStat);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MatchResult {
	    map: string;
	    type: string;
	    mode: string;
	    role: string;
	    hero: string;
	    eliminations: number;
	    assists: number;
	    deaths: number;
	    damage: number;
	    healing: number;
	    mitigation: number;
	    result?: string;
	    final_score?: string;
	    date?: string;
	    finished_at?: string;
	    game_length?: string;
	    heroes_played?: HeroPlay[];
	    performance?: Performance;
	    rank?: string;
	    level?: number;
	    modifiers?: string[];
	    rank_progress?: number;
	    change_percent?: number;
	    sr?: HeroSR[];
	
	    static createFrom(source: any = {}) {
	        return new MatchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.map = source["map"];
	        this.type = source["type"];
	        this.mode = source["mode"];
	        this.role = source["role"];
	        this.hero = source["hero"];
	        this.eliminations = source["eliminations"];
	        this.assists = source["assists"];
	        this.deaths = source["deaths"];
	        this.damage = source["damage"];
	        this.healing = source["healing"];
	        this.mitigation = source["mitigation"];
	        this.result = source["result"];
	        this.final_score = source["final_score"];
	        this.date = source["date"];
	        this.finished_at = source["finished_at"];
	        this.game_length = source["game_length"];
	        this.heroes_played = this.convertValues(source["heroes_played"], HeroPlay);
	        this.performance = this.convertValues(source["performance"], Performance);
	        this.rank = source["rank"];
	        this.level = source["level"];
	        this.modifiers = source["modifiers"];
	        this.rank_progress = source["rank_progress"];
	        this.change_percent = source["change_percent"];
	        this.sr = this.convertValues(source["sr"], HeroSR);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

