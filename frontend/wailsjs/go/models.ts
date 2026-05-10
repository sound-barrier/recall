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
	    type: string;
	    competitive: boolean;
	    role: string;
	    hero: string;
	    eliminations: number;
	    assists: number;
	    deaths: number;
	    damage: number;
	    healing: number;
	    mitigation: number;
	
	    static createFrom(source: any = {}) {
	        return new MatchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.map = source["map"];
	        this.type = source["type"];
	        this.competitive = source["competitive"];
	        this.role = source["role"];
	        this.hero = source["hero"];
	        this.eliminations = source["eliminations"];
	        this.assists = source["assists"];
	        this.deaths = source["deaths"];
	        this.damage = source["damage"];
	        this.healing = source["healing"];
	        this.mitigation = source["mitigation"];
	    }
	}

}

