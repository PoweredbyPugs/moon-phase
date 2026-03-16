import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface MoonData {
    moonPhase: string;
    moonSign: string;
    degreeInSign: string;
    localEasternTime?: string;
}

interface WeeklyMoonPhase {
    date: string;
    moonPhase: string;
    moonSign: string;
}

interface PlanetData {
    name: string;
    sign: string;
    degreeInSign: string;
    isRetrograde: boolean;
}

interface PlanetsResponse {
    localEasternTime: string;
    planets: PlanetData[];
}

interface MoonPluginSettings {
    serverUrl: string;
    // Planet toggles
    enableSun: boolean;
    enableMoon: boolean;
    enableMercury: boolean;
    enableVenus: boolean;
    enableMars: boolean;
    enableJupiter: boolean;
    enableSaturn: boolean;
    enableUranus: boolean;
    enableNeptune: boolean;
    enablePluto: boolean;
    // Aspect toggles
    enableConjunction: boolean;
    enableOpposition: boolean;
    enableTrine: boolean;
    enableSquare: boolean;
    enableSextile: boolean;
    enableQuincunx: boolean;
    enableSemiSextile: boolean;
    enableSemiSquare: boolean;
    enableSesquiquadrate: boolean;
    enableQuintile: boolean;
}

const DEFAULT_SETTINGS: MoonPluginSettings = {
    serverUrl: 'http://localhost:3000',
    // Default all planets to enabled
    enableSun: true,
    enableMoon: true,
    enableMercury: true,
    enableVenus: true,
    enableMars: true,
    enableJupiter: true,
    enableSaturn: true,
    enableUranus: true,
    enableNeptune: true,
    enablePluto: true,
    // Default major aspects to enabled, minor aspects to disabled
    enableConjunction: true,
    enableOpposition: true,
    enableTrine: true,
    enableSquare: true,
    enableSextile: true,
    enableQuincunx: false,
    enableSemiSextile: false,
    enableSemiSquare: false,
    enableSesquiquadrate: false,
    enableQuintile: false
}

interface AspectData {
    planet1: string;
    planet2: string;
    aspectName: string;
    aspectSymbol: string;
    exactAngle: string;
    orb: string;
    planet1Sign: string;
    planet2Sign: string;
    planet1Retrograde: boolean;
    planet2Retrograde: boolean;
}

interface AspectsResponse {
    localEasternTime: string;
    aspects: AspectData[];
}


export default class MoonPlugin extends Plugin {
    settings: MoonPluginSettings;
    
public api = {
    getMoonData: this.getMoonData.bind(this),
    getMoonPhaseEmoji: this.getMoonPhaseEmoji.bind(this),
    getWeeklyMajorPhase: this.getWeeklyMajorPhase.bind(this),
    getPlanetaryData: this.getPlanetaryData.bind(this),
    getPlanetGlyph: this.getPlanetGlyph.bind(this),
    getAspectsData: this.getAspectsData.bind(this)
};
    
    async onload() {
        await this.loadSettings();
        
        // Add settings tab
        this.addSettingTab(new MoonSettingTab(this.app, this));
        
        // Command 1: Current Moon Phase (emoji and sign only)
        this.addCommand({
            id: 'current-moon-phase',
            name: 'Current Moon Phase',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.getMoonData().then(moonData => {
                    const moonEmoji = this.getMoonPhaseEmoji(moonData.moonPhase);
                    editor.replaceSelection(`${moonEmoji} ${moonData.moonSign}`);
                }).catch(error => {
                    console.error('Error fetching moon data:', error);
                    editor.replaceSelection('Error fetching moon data. Check console for details.');
                });
            }
        });
        
        // Command 2: Current Moon Degree (emoji, sign, and degree)
        this.addCommand({
            id: 'current-moon-degree',
            name: 'Current Moon Degree',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.getMoonData().then(moonData => {
                    const moonEmoji = this.getMoonPhaseEmoji(moonData.moonPhase);
                    editor.replaceSelection(`${moonEmoji} ${moonData.moonSign} ${moonData.degreeInSign}˚`);
                }).catch(error => {
                    console.error('Error fetching moon data:', error);
                    editor.replaceSelection('Error fetching moon data. Check console for details.');
                });
            }
        });

        // Command 3: Weekly Phase (only major phase in current week)
        this.addCommand({
            id: 'weekly-phase',
            name: 'Weekly Phase',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.getWeeklyMajorPhase().then(phase => {
                    if (!phase) {
                        editor.replaceSelection('No major moon phase this week.');
                        return;
                    }
                    
                    const moonEmoji = this.getMoonPhaseEmoji(phase.moonPhase);
                    editor.replaceSelection(`${moonEmoji} ${phase.moonSign}`);
                }).catch(error => {
                    console.error('Error fetching weekly moon phase:', error);
                    editor.replaceSelection('Error fetching weekly moon phase. Check console for details.');
                });
            }
        });

        // Command 4: All Planetary Positions
        this.addCommand({
            id: 'planetary-positions',
            name: 'All Planetary Positions',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.getPlanetaryData().then(data => {
                    let output = '';
                    
                    data.planets.forEach(planet => {
                        const glyph = this.getPlanetGlyph(planet.name);
                        const retroMark = planet.isRetrograde ? ' ℞' : '';
                        output += `${glyph} ${planet.sign} ${planet.degreeInSign}˚${retroMark}\n`;
                    });
                    
                    editor.replaceSelection(output.trim());
                }).catch(error => {
                    console.error('Error fetching planetary data:', error);
                    editor.replaceSelection('Error fetching planetary data. Check console for details.');
                });
            }
        });

        // Command 5: Single Planet Position (submenu)
        const planets = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
        
        planets.forEach(planetName => {
            this.addCommand({
                id: `${planetName.toLowerCase()}-position`,
                name: `${planetName} Position`,
                editorCallback: (editor: Editor, view: MarkdownView) => {
                    this.getPlanetaryData().then(data => {
                        const planet = data.planets.find(p => p.name === planetName);
                        
                        if (planet) {
                            const glyph = this.getPlanetGlyph(planet.name);
                            const retroMark = planet.isRetrograde ? ' ℞' : '';
                            editor.replaceSelection(`${glyph} ${planet.sign} ${planet.degreeInSign}˚${retroMark}`);
                        } else {
                            editor.replaceSelection(`Error: ${planetName} data not found`);
                        }
                    }).catch(error => {
                        console.error(`Error fetching ${planetName} data:`, error);
                        editor.replaceSelection(`Error fetching ${planetName} data. Check console for details.`);
                    });
                }
            });
        });

// Command 6: All Current Aspects
this.addCommand({
    id: 'all-aspects',
    name: 'All Current Aspects',
    editorCallback: (editor: Editor, view: MarkdownView) => {
        this.getAspectsData().then(data => {
            if (data.aspects.length === 0) {
                editor.replaceSelection('No significant aspects currently.');
                return;
            }
            
            let output = '';
            
            data.aspects.forEach(aspect => {
                const planet1Glyph = this.getPlanetGlyph(aspect.planet1);
                const planet2Glyph = this.getPlanetGlyph(aspect.planet2);
                const retrograde1 = aspect.planet1Retrograde ? ' ℞' : '';
                const retrograde2 = aspect.planet2Retrograde ? ' ℞' : '';
                
                output += `${planet1Glyph}${retrograde1} ${aspect.aspectSymbol} ${planet2Glyph}${retrograde2}\n`;
            });
            
            editor.replaceSelection(output.trim());
        }).catch(error => {
            console.error('Error fetching aspects data:', error);
            editor.replaceSelection('Error fetching aspects data. Check console for details.');
        });
    }

    

});

// Command 7: Aspects for specific planet
const planetsForAspects = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

planetsForAspects.forEach(planetName => {
    this.addCommand({
        id: `${planetName.toLowerCase()}-aspects`,
        name: `${planetName} Aspects`,
        editorCallback: (editor: Editor, view: MarkdownView) => {
            this.getAspectsData().then(data => {
                // Filter aspects involving this planet
                const relevantAspects = data.aspects.filter(aspect => 
                    aspect.planet1 === planetName || aspect.planet2 === planetName
                );
                
                if (relevantAspects.length === 0) {
                    editor.replaceSelection(`No significant aspects for ${planetName} currently.`);
                    return;
                }
                
                let output = '';
                
                relevantAspects.forEach(aspect => {
                    // Ensure the specified planet is always planet1 for consistent display
                    let planet1, planet2, retrograde1, retrograde2, planet1Glyph, planet2Glyph;
                    
                    if (aspect.planet1 === planetName) {
                        planet1 = aspect.planet1;
                        planet2 = aspect.planet2;
                        retrograde1 = aspect.planet1Retrograde ? ' ℞' : '';
                        retrograde2 = aspect.planet2Retrograde ? ' ℞' : '';
                    } else {
                        planet1 = aspect.planet2;
                        planet2 = aspect.planet1;
                        retrograde1 = aspect.planet2Retrograde ? ' ℞' : '';
                        retrograde2 = aspect.planet1Retrograde ? ' ℞' : '';
                    }
                    
                    planet1Glyph = this.getPlanetGlyph(planet1);
                    planet2Glyph = this.getPlanetGlyph(planet2);
                    
                    output += `${planet1Glyph}${retrograde1} ${aspect.aspectSymbol} ${planet2Glyph}${retrograde2}\n`;
                });
                
                editor.replaceSelection(output.trim());
            }).catch(error => {
                console.error(`Error fetching ${planetName} aspects:`, error);
                editor.replaceSelection(`Error fetching ${planetName} aspects. Check console for details.`);
            });
        }
    });
});

// Command 8: Specific aspect types
const aspectTypes = ['Conjunction', 'Opposition', 'Trine', 'Square', 'Sextile'];

aspectTypes.forEach(aspectName => {
    this.addCommand({
        id: `${aspectName.toLowerCase()}-aspects`,
        name: `${aspectName} Aspects`,
        editorCallback: (editor: Editor, view: MarkdownView) => {
            this.getAspectsData().then(data => {
                // Filter aspects of this type
                const relevantAspects = data.aspects.filter(aspect => 
                    aspect.aspectName === aspectName
                );
                
                if (relevantAspects.length === 0) {
                    editor.replaceSelection(`No ${aspectName} aspects currently.`);
                    return;
                }
                
                let output = '';
                
                relevantAspects.forEach(aspect => {
                    const planet1Glyph = this.getPlanetGlyph(aspect.planet1);
                    const planet2Glyph = this.getPlanetGlyph(aspect.planet2);
                    const retrograde1 = aspect.planet1Retrograde ? ' ℞' : '';
                    const retrograde2 = aspect.planet2Retrograde ? ' ℞' : '';
                    
                    output += `${planet1Glyph}${retrograde1} ${aspect.aspectSymbol} ${planet2Glyph}${retrograde2}\n`;
                });
                
                editor.replaceSelection(output.trim());
            }).catch(error => {
                console.error(`Error fetching ${aspectName} aspects:`, error);
                editor.replaceSelection(`Error fetching ${aspectName} aspects. Check console for details.`);
            });
        }
    });
});


    }

    onunload() {
        // Nothing special to clean up
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Function to get moon data from the server
    async getMoonData(): Promise<MoonData> {
        const response = await fetch(`${this.settings.serverUrl}/moon-now`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data as MoonData;
    }

    async getPlanetaryData(): Promise<PlanetsResponse> {
        const response = await fetch(`${this.settings.serverUrl}/planets-now`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Filter planets based on settings
        const filteredPlanets = data.planets.filter((planet: PlanetData) => 
            this.isPlanetEnabled(planet.name)
        );
        
        return {
            localEasternTime: data.localEasternTime,
            planets: filteredPlanets
        } as PlanetsResponse;
    }
    
    async getAspectsData(): Promise<AspectsResponse> {
        const response = await fetch(`${this.settings.serverUrl}/aspects-now`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Filter aspects based on settings
        const filteredAspects = data.aspects.filter((aspect: AspectData) => {
            // Check if both planets are enabled
            const planet1Enabled = this.isPlanetEnabled(aspect.planet1);
            const planet2Enabled = this.isPlanetEnabled(aspect.planet2);
            
            // Check if the aspect type is enabled
            const aspectEnabled = this.isAspectEnabled(aspect.aspectName);
            
            return planet1Enabled && planet2Enabled && aspectEnabled;
        });
        
        // Return filtered data
        return {
            localEasternTime: data.localEasternTime,
            aspects: filteredAspects
        } as AspectsResponse;
    }

// Add these new helper methods right after getAspectsData()
isPlanetEnabled(planetName: string): boolean {
    switch(planetName) {
        case 'Sun': return this.settings.enableSun;
        case 'Moon': return this.settings.enableMoon;
        case 'Mercury': return this.settings.enableMercury;
        case 'Venus': return this.settings.enableVenus;
        case 'Mars': return this.settings.enableMars;
        case 'Jupiter': return this.settings.enableJupiter;
        case 'Saturn': return this.settings.enableSaturn;
        case 'Uranus': return this.settings.enableUranus;
        case 'Neptune': return this.settings.enableNeptune;
        case 'Pluto': return this.settings.enablePluto;
        default: return false;
    }
}

isAspectEnabled(aspectName: string): boolean {
    switch(aspectName) {
        case 'Conjunction': return this.settings.enableConjunction;
        case 'Opposition': return this.settings.enableOpposition;
        case 'Trine': return this.settings.enableTrine;
        case 'Square': return this.settings.enableSquare;
        case 'Sextile': return this.settings.enableSextile;
        case 'Quincunx': return this.settings.enableQuincunx;
        case 'Semi-sextile': return this.settings.enableSemiSextile;
        case 'Semi-square': return this.settings.enableSemiSquare;
        case 'Sesquiquadrate': return this.settings.enableSesquiquadrate;
        case 'Quintile': return this.settings.enableQuintile;
        default: return false;
    }
}
    

    // Function to map moon phase to emoji
    getMoonPhaseEmoji(phase: string): string {
        switch (phase) {
            case 'New Moon':
                return '🌑';
            case 'Waxing Crescent':
                return '🌒';
            case 'First Quarter':
                return '🌓';
            case 'Waxing Gibbous':
                return '🌔';
            case 'Full Moon':
                return '🌕';
            case 'Waning Gibbous':
                return '🌖';
            case 'Last Quarter':
                return '🌗';
            case 'Waning Crescent':
                return '🌘';
            default:
                return '🌙';
        }
    }

    // Function to map planet name to astrological glyph
    getPlanetGlyph(planetName: string): string {
        switch (planetName) {
            case 'Sun':
                return '☉';
            case 'Moon':
                return '☽';
            case 'Mercury':
                return '☿';
            case 'Venus':
                return '♀';
            case 'Mars':
                return '♂';
            case 'Jupiter':
                return '♃';
            case 'Saturn':
                return '♄';
            case 'Uranus':
                return '♅';
            case 'Neptune':
                return '♆';
            case 'Pluto':
                return '♇';
            default:
                return '★'; // Default star symbol
        }
    }

    // Function to get the Monday of the current week
    getMonday(d: Date): Date {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
        return new Date(date.setDate(diff));
    }

    // Function to format date as YYYY-MM-DD
    formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Function to get major moon phases for the current week
    async getWeeklyMajorPhase(): Promise<WeeklyMoonPhase | null> {
        try {
            // Call the new endpoint for weekly major phase
            const response = await fetch(`${this.settings.serverUrl}/weekly-major-phase`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Check if we got a valid major phase or an empty result
            if (data.moonPhase) {
                return {
                    date: data.date,
                    moonPhase: data.moonPhase,
                    moonSign: data.moonSign
                };
            }
            
            // No major phase found for this week
            return null;
        } catch (error) {
            console.error('Error fetching weekly moon phase:', error);
            return null;
        }
    }
}

class MoonSettingTab extends PluginSettingTab {
    plugin: MoonPlugin;

    constructor(app: App, plugin: MoonPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', {text: 'Moon Phase Settings'});
        
        // Server settings
        new Setting(containerEl)
            .setName('Server URL')
            .setDesc('URL to the moon data server (including protocol, no trailing slash)')
            .addText(text => text
                .setPlaceholder('http://localhost:3000')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = value;
                    await this.plugin.saveSettings();
                }));
        
       // Planet Settings
containerEl.createEl('h3', {text: 'Planets'});
containerEl.createEl('p', {text: 'Select which planets to include in calculations'});

new Setting(containerEl)
    .setName('Sun')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSun)
        .onChange(async (value) => {
            this.plugin.settings.enableSun = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Moon')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableMoon)
        .onChange(async (value) => {
            this.plugin.settings.enableMoon = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Mercury')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableMercury)
        .onChange(async (value) => {
            this.plugin.settings.enableMercury = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Venus')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableVenus)
        .onChange(async (value) => {
            this.plugin.settings.enableVenus = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Mars')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableMars)
        .onChange(async (value) => {
            this.plugin.settings.enableMars = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Jupiter')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableJupiter)
        .onChange(async (value) => {
            this.plugin.settings.enableJupiter = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Saturn')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSaturn)
        .onChange(async (value) => {
            this.plugin.settings.enableSaturn = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Uranus')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableUranus)
        .onChange(async (value) => {
            this.plugin.settings.enableUranus = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Neptune')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableNeptune)
        .onChange(async (value) => {
            this.plugin.settings.enableNeptune = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Pluto')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enablePluto)
        .onChange(async (value) => {
            this.plugin.settings.enablePluto = value;
            await this.plugin.saveSettings();
        }))

        // Aspect Settings
containerEl.createEl('h3', {text: 'Aspects'});
containerEl.createEl('p', {text: 'Select which aspects to include in calculations'});

new Setting(containerEl)
    .setName('Conjunction (☌)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableConjunction)
        .onChange(async (value) => {
            this.plugin.settings.enableConjunction = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Opposition (☍)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableOpposition)
        .onChange(async (value) => {
            this.plugin.settings.enableOpposition = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Trine (△)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableTrine)
        .onChange(async (value) => {
            this.plugin.settings.enableTrine = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Square (□)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSquare)
        .onChange(async (value) => {
            this.plugin.settings.enableSquare = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Sextile (⚹)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSextile)
        .onChange(async (value) => {
            this.plugin.settings.enableSextile = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Quincunx (⚻)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableQuincunx)
        .onChange(async (value) => {
            this.plugin.settings.enableQuincunx = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Semi-sextile (⚺)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSemiSextile)
        .onChange(async (value) => {
            this.plugin.settings.enableSemiSextile = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Semi-square (⚼)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSemiSquare)
        .onChange(async (value) => {
            this.plugin.settings.enableSemiSquare = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Sesquiquadrate (⚿)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSesquiquadrate)
        .onChange(async (value) => {
            this.plugin.settings.enableSesquiquadrate = value;
            await this.plugin.saveSettings();
        }));

new Setting(containerEl)
    .setName('Quintile (Q)')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableQuintile)
        .onChange(async (value) => {
            this.plugin.settings.enableQuintile = value;
            await this.plugin.saveSettings();
        }));
        
    };}
