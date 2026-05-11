export namespace main {
	
	export class MatchRecord {
	    id: number;
	    match_key: string;
	    source_files: string[];
	    data: parser.MatchResult;
	
	    static createFrom(source: any = {}) {
	        return new MatchRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.match_key = source["match_key"];
	        this.source_files = source["source_files"];
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

}

export namespace parser {
	
	export class HeroPlay {
	    hero: string;
	    percent_played: number;
	    play_time?: string;
	
	    static createFrom(source: any = {}) {
	        return new HeroPlay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hero = source["hero"];
	        this.percent_played = source["percent_played"];
	        this.play_time = source["play_time"];
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
	    personal_stats?: Record<string, number>;
	
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
	        this.personal_stats = source["personal_stats"];
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

