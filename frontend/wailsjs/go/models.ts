export namespace main {
	
	export class MatchRecord {
	    id: number;
	    source_file: string;
	    data: parser.MatchResult;
	
	    static createFrom(source: any = {}) {
	        return new MatchRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.source_file = source["source_file"];
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
	
	export class MatchResult {
	    map: string;
	    role: string;
	    eliminations: number;
	    assists: number;
	    deaths: number;
	    damage: number;
	    healing: number;
	    mitigation: number;
	    characters: string[];
	    final_blows: number;
	    solo_kills: number;
	
	    static createFrom(source: any = {}) {
	        return new MatchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.map = source["map"];
	        this.role = source["role"];
	        this.eliminations = source["eliminations"];
	        this.assists = source["assists"];
	        this.deaths = source["deaths"];
	        this.damage = source["damage"];
	        this.healing = source["healing"];
	        this.mitigation = source["mitigation"];
	        this.characters = source["characters"];
	        this.final_blows = source["final_blows"];
	        this.solo_kills = source["solo_kills"];
	    }
	}

}

