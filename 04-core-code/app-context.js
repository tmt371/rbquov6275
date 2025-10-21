// File: 04-core-code/app-context.js

import { EventAggregator } from './event-aggregator.js';
import { StateService } from './services/state-service.js';
import { CalculationService } from './services/calculation-service.js';
import { FileService } from './services/file-service.js';
import { MigrationService } from './services/migration-service.js';
import { WorkflowService } from './services/workflow-service.js';
import { FocusService } from './services/focus-service.js';
import { AppController } from './app-controller.js';
import { UIManager } from './ui/ui-manager.js';
import { TableComponent } from './ui/table-component.js';
import { SummaryComponent } from './ui/summary-component.js';
import { NotificationComponent } from './ui/notification-component.js';
import { DialogComponent } from './ui/dialog-component.js';
import { ConfigManager } from './config-manager.js';
import { ProductFactory } from './strategies/product-factory.js';
import { LeftPanelInputHandler } from './ui/left-panel-input-handler.js';

// Views
import { F1CostView } from './ui/views/f1-cost-view.js';
import { F2SummaryView } from './ui/views/f2-summary-view.js';
import { F3QuotePrepView } from './ui/views/f3-quote-prep-view.js';
import { F4ActionsView } from './ui/views/f4-actions-view.js';
import { K1LocationView } from './ui/views/k1-location-view.js';
import { K2FabricView } from './ui/views/k2-fabric-view.js';
import { K3OptionsView } from './ui/views/k3-options-view.js';
import { DualChainView } from './ui/views/dual-chain-view.js';
import { DriveAccessoriesView } from './ui/views/drive-accessories-view.js';
import { DetailConfigView } from './ui/views/detail-config-view.js';

// Core UI Components to be instantiated by main.js
import { LeftPanelComponent } from './ui/left-panel-component.js';
import { RightPanelComponent } from './ui/right-panel-component.js';
import { QuotePreviewComponent } from './ui/quote-preview-component.js';

/**
 * @fileoverview Acts as a Dependency Injection (DI) container.
 * Initializes and wires up all the major components of the application.
 */
export class AppContext {
    constructor() {
        // [CORRECTED] Use an object to store factory functions, not instances.
        this.factories = {};
        this.instances = {};
    }

    /**
     * Initializes all services and components.
     * @param {Object} uiElements - A dictionary of pre-fetched DOM elements from main.js
     */
    async initialize(uiElements) {
        // Core Utilities
        this.register('eventAggregator', () => new EventAggregator());
        await this.initializeConfigManager();

        // Core Services
        this.initializeCoreServices();

        // UI Managers and Components
        this.initializeUIComponents(uiElements);

        console.log('AppContext Initialized.');
    }

    /**
     * [CORRECTED] Registers a factory function for a dependency.
     * @param {string} name - The name of the dependency.
     * @param {function} factory - A function that creates the dependency.
     */
    register(name, factory) {
        this.factories[name] = factory;
    }

    /**
     * [CORRECTED] Resolves a dependency. It creates the instance only once (singleton).
     * @param {string} name - The name of the dependency.
     * @returns {*} The resolved dependency instance.
     */
    get(name) {
        if (!this.instances[name]) {
            const factory = this.factories[name];
            if (!factory) {
                throw new Error(`Dependency not found: ${name}`);
            }
            // Create the instance and pass 'this' (the context) to the factory.
            this.instances[name] = factory(this);
        }
        return this.instances[name];
    }

    /**
     * Initializes the ConfigManager which is required by many other services.
     */
    async initializeConfigManager() {
        this.register('configManager', () => new ConfigManager());
        await this.get('configManager').loadPriceMatrices();
    }

    /**
     * Initializes all the core, non-UI services.
     */
    initializeCoreServices() {
        this.register('migrationService', (ctx) => new MigrationService());
        this.register('stateService', (ctx) => new StateService({ migrationService: ctx.get('migrationService') }));
        this.register('productFactory', (ctx) => new ProductFactory({ configManager: ctx.get('configManager') }));
        this.register('calculationService', (ctx) => new CalculationService({ productFactory: ctx.get('productFactory'), stateService: ctx.get('stateService') }));
        this.register('fileService', () => new FileService());
        this.register('focusService', (ctx) => new FocusService({ eventAggregator: ctx.get('eventAggregator') }));

        // Views (required by WorkflowService and AppController)
        this.register('k1LocationView', (ctx) => new K1LocationView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService') }));
        this.register('k2FabricView', (ctx) => new K2FabricView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService'), configManager: ctx.get('configManager') }));
        this.register('k3OptionsView', (ctx) => new K3OptionsView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService') }));
        this.register('dualChainView', (ctx) => new DualChainView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService'), calculationService: ctx.get('calculationService') }));
        this.register('driveAccessoriesView', (ctx) => new DriveAccessoriesView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService'), calculationService: ctx.get('calculationService') }));
        this.register('detailConfigView', (ctx) => new DetailConfigView({
            eventAggregator: ctx.get('eventAggregator'),
            stateService: ctx.get('stateService'),
            k1LocationView: ctx.get('k1LocationView'),
            k2FabricView: ctx.get('k2FabricView'),
            k3OptionsView: ctx.get('k3OptionsView'),
            dualChainView: ctx.get('dualChainView'),
            driveAccessoriesView: ctx.get('driveAccessoriesView'),
        }));
        
        this.register('workflowService', (ctx) => new WorkflowService({
            eventAggregator: ctx.get('eventAggregator'),
            stateService: ctx.get('stateService'),
            fileService: ctx.get('fileService'),
            calculationService: ctx.get('calculationService'),
            productFactory: ctx.get('productFactory'),
            detailConfigView: ctx.get('detailConfigView'),
            configManager: ctx.get('configManager'), // [THE ONLY REQUIRED CHANGE]
        }));
        
        this.register('appController', (ctx) => new AppController(ctx));
    }

    /**
     * Initializes UI-related components.
     * @param {Object} uiElements - A dictionary of pre-fetched DOM elements from main.js
     */
    initializeUIComponents(uiElements) {
        // This is a special case. These are already instances. We store them directly.
        this.instances.leftPanelComponent = uiElements.leftPanelComponent;
        this.instances.rightPanelComponent = uiElements.rightPanelComponent;
        this.instances.quotePreviewComponent = uiElements.quotePreviewComponent;

        // Now that quotePreviewComponent is available, set it on the workflowService
        this.get('workflowService').setQuotePreviewComponent(this.get('quotePreviewComponent'));

        // Views for RightPanelComponent
        this.register('f1CostView', (ctx) => new F1CostView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService') }));
        this.register('f2SummaryView', (ctx) => new F2SummaryView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService') }));
        this.register('f3QuotePrepView', (ctx) => new F3QuotePrepView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService') }));
        this.register('f4ActionsView', (ctx) => new F4ActionsView({ eventAggregator: ctx.get('eventAggregator'), stateService: ctx.get('stateService') }));

        // Pass view instances to RightPanelComponent
        this.get('rightPanelComponent').setViews({
            f1CostView: this.get('f1CostView'),
            f2SummaryView: this.get('f2SummaryView'),
            f3QuotePrepView: this.get('f3QuotePrepView'),
            f4ActionsView: this.get('f4ActionsView'),
        });
        
        // Pass view instances to LeftPanelComponent
        this.get('leftPanelComponent').setViews({
            detailConfigView: this.get('detailConfigView')
        });

        // Other UI Components
        this.register('tableComponent', (ctx) => new TableComponent({
            eventAggregator: ctx.get('eventAggregator'),
            stateService: ctx.get('stateService'),
            configManager: ctx.get('configManager'),
            productFactory: ctx.get('productFactory'),
        }));
        this.register('summaryComponent', (ctx) => new SummaryComponent({ stateService: ctx.get('stateService') }));
        this.register('notificationComponent', () => new NotificationComponent());
        this.register('dialogComponent', (ctx) => new DialogComponent({ eventAggregator: ctx.get('eventAggregator') }));
        
        this.register('leftPanelInputHandler', (ctx) => new LeftPanelInputHandler({
            eventAggregator: ctx.get('eventAggregator'),
            stateService: ctx.get('stateService'),
            detailConfigView: ctx.get('detailConfigView')
        }));

        // The master UI coordinator
        this.register('uiManager', (ctx) => new UIManager({
            eventAggregator: ctx.get('eventAggregator'),
            stateService: ctx.get('stateService'),
            components: {
                table: ctx.get('tableComponent'),
                summary: ctx.get('summaryComponent'),
                leftPanel: ctx.get('leftPanelComponent'),
                rightPanel: ctx.get('rightPanelComponent'),
                notification: ctx.get('notificationComponent'),
                dialog: ctx.get('dialogComponent'),
                quotePreview: ctx.get('quotePreviewComponent'),
            }
        }));
    }
}