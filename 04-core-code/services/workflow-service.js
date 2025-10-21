// File: 04-core-code/services/workflow-service.js

import { initialState } from '../config/initial-state.js';
import { EVENTS, DOM_IDS } from '../config/constants.js';
import * as uiActions from '../actions/ui-actions.js';
import * as quoteActions from '../actions/quote-actions.js';
import { paths } from '../config/paths.js';

/**
 * @fileoverview A dedicated service for coordinating complex, multi-step user workflows.
 * This service takes complex procedural logic out of the AppController.
 */
export class WorkflowService {
    constructor({
        eventAggregator,
        stateService,
        fileService,
        calculationService,
        productFactory,
        detailConfigView,
        configManager, // [FIX] Added missing dependency
    }) {
        this.eventAggregator = eventAggregator;
        this.stateService = stateService;
        this.fileService = fileService;
        this.calculationService = calculationService;
        this.productFactory = productFactory;
        this.detailConfigView = detailConfigView;
        this.configManager = configManager; // [FIX] Store the dependency
        this.quotePreviewComponent = null; // Will be set by AppContext

        this.f2InputSequence = [
            'f2-b10-wifi-qty',
            'f2-b13-delivery-qty',
            'f2-b14-install-qty',
            'f2-b15-removal-qty',
            'f2-b17-mul-times',
            'f2-b18-discount',
        ];
        console.log('WorkflowService Initialized.');
    }

    // [HELPER] Setter for the QuotePreviewComponent dependency
    setQuotePreviewComponent(component) {
        this.quotePreviewComponent = component;
    }

    // [HELPER] Gets current items for the active product
    _getItems() {
        const { quoteData } = this.stateService.getState();
        const productKey = quoteData.currentProduct;
        return quoteData.products[productKey]?.items || [];
    }

    // [HELPER] Formats a number into a currency string
    _formatCurrency(value, decimals = 2) {
        if (typeof value !== 'number') return '';
        return `$${value.toFixed(decimals)}`;
    }

    // [HELPER] Gets the class for the appendix table row based on fabric type
    _getFabricRowClass(item) {
        if (item.fabric && item.fabric.toLowerCase().includes('light-filter')) {
            return 'bg-light-filter';
        }
        if (['B1', 'B2', 'B3', 'B4', 'B5'].includes(item.fabricType)) {
            return 'bg-blockout';
        }
        if (item.fabricType === 'SN') {
            return 'bg-screen';
        }
        return '';
    }

    /**
     * [REFACTORED V1 - STAGE 1] Handles the request for a printable quote.
     * This version focuses ONLY on preparing the data object and logging it for verification.
     * HTML rendering is deferred to Stage 2.
     */
    async handlePrintableQuoteRequest() {
        try {
            const f3Data = this._getF3OverrideData();
            const { quoteData, ui } = this.stateService.getState();
            const summaryData = this.calculationService.calculateF2Summary(
                quoteData,
                ui
            );

            // --- Prepare Data for Page 1 (Overview) ---
            const { html: page1ItemsHtml, subtotal } =
                this._preparePage1Items(summaryData, quoteData, ui);
            const gst = subtotal * 0.1;
            const grandTotal = subtotal + gst;
            const deposit = grandTotal * 0.5;
            const balance = grandTotal - deposit;
            const savings = summaryData.firstRbPrice - summaryData.disRbPrice;

            // --- Prepare Data for Page 2 (Appendix) ---
            const rollerBlindsTableHtml = this._preparePage2RollerBlindsTable(
                quoteData,
                ui,
                summaryData.mulTimes
            );
            const motorisedTableHtml = this._preparePage2MotorisedTable(ui);

            // --- Assemble the final data object for verification ---
            const templateData = {
                // Meta
                quoteId: f3Data.quoteId,
                issueDate: f3Data.issueDate
                    ? new Date(f3Data.issueDate).toLocaleDateString('en-AU')
                    : '',
                dueDate: f3Data.dueDate
                    ? new Date(f3Data.dueDate).toLocaleDateString('en-AU')
                    : '',

                // Customer
                customerInfoHtml: this._formatCustomerInfo(f3Data),

                // Page 1 Items
                itemsTableBody: page1ItemsHtml, // This is just a placeholder for now

                // Page 1 Summary
                subtotal: this._formatCurrency(subtotal),
                gst: this._formatCurrency(gst),
                grandTotal: this._formatCurrency(grandTotal),
                deposit: this._formatCurrency(deposit),
                balance: this._formatCurrency(balance),
                savings: this._formatCurrency(savings),
                termsAndConditions: f3Data.termsConditions.replace(/\n/g, '<br>'),

                // Page 2 Appendix
                appendixQuoteId: f3Data.quoteId,
                rollerBlindsTable: rollerBlindsTableHtml, // Placeholder
                motorisedAccessoriesTable: motorisedTableHtml, // Placeholder
            };

            // [STAGE 1 GOAL] Log the prepared data object for verification.
            console.log('--- TEMPLATE DATA FOR VERIFICATION ---', templateData);
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                message:
                    'Template data prepared. Please check the console for verification.',
            });

            // The following lines for rendering are commented out for Stage 1.
            /*
            const [quoteTemplate, detailsTemplate] = await Promise.all([
                fetch(paths.partials.quoteTemplate).then(res => res.text()),
                fetch(paths.partials.detailedItemList).then(res => res.text()),
            ]);
            const populatedDetails = this._populateTemplate(detailsTemplate, templateData);
            const finalHtml = this._populateTemplate(quoteTemplate, { ...templateData, detailedItemList: populatedDetails });
            this.eventAggregator.publish(EVENTS.SHOW_QUOTE_PREVIEW, finalHtml);
            */
        } catch (error) {
            console.error('Error generating printable quote data:', error);
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                message:
                    'Failed to generate quote data. See console for details.',
                type: 'error',
            });
        }
    }

    /**
     * [NEW] Prepares the HTML string for the items table on page 1.
     * @returns {{html: string, subtotal: number}}
     */
    _preparePage1Items(summaryData, quoteData, ui) {
        const items = this._getItems();
        const validItemCount = items.filter((i) => i.width && i.height).length;
        let rowsHtml = '';
        let subtotal = 0;
        let itemCounter = 1;

        const createRow = (
            description,
            details,
            qty,
            price,
            discountedPrice,
            isExcluded = false
        ) => {
            const priceText = isExcluded
                ? `<span class="original-price">${this._formatCurrency(price)}</span>`
                : this._formatCurrency(price);
            const discountedPriceText = this._formatCurrency(discountedPrice);
            subtotal += discountedPrice;

            return `
                <tr>
                    <td data-label="#">${itemCounter++}</td>
                    <td data-label="Description">
                        <div class="description">${description}</div>
                        <div class="details">${details}</div>
                    </td>
                    <td data-label="QTY" class="align-right">${qty}</td>
                    <td data-label="Price" class="align-right">${priceText}</td>
                    <td data-label="Discounted Price" class="align-right discounted-price">${discountedPriceText}</td>
                </tr>
            `;
        };

        // 1. Roller Blinds
        if (summaryData.disRbPrice > 0) {
            rowsHtml += createRow(
                'Roller Blinds',
                'See attached list for details.',
                validItemCount,
                summaryData.firstRbPrice,
                summaryData.disRbPrice
            );
        }

        // 2. Installation Accessories
        if (summaryData.acceSum > 0) {
            rowsHtml += createRow(
                'Installation Accessories',
                'Dual Brackets, HD Winders, etc.',
                'N/A',
                summaryData.acceSum,
                summaryData.acceSum
            );
        }

        // 3. Motorised Sets
        if (summaryData.eAcceSum > 0) {
            rowsHtml += createRow(
                'Motorised Sets & Accessories',
                'Motors, Remotes, Chargers, etc.',
                'N/A',
                summaryData.eAcceSum,
                summaryData.eAcceSum
            );
        }

        // 4. Delivery
        if (summaryData.deliveryFee > 0) {
            rowsHtml += createRow(
                'Delivery',
                '',
                ui.f2.deliveryQty || 1,
                summaryData.deliveryFee,
                ui.f2.deliveryFeeExcluded ? 0 : summaryData.deliveryFee,
                ui.f2.deliveryFeeExcluded
            );
        }

        // 5. Installation
        if (summaryData.installFee > 0) {
            rowsHtml += createRow(
                'Installation',
                '',
                ui.f2.installQty || validItemCount,
                summaryData.installFee,
                ui.f2.installFeeExcluded ? 0 : summaryData.installFee,
                ui.f2.installFeeExcluded
            );
        }

        // 6. Removal
        if (summaryData.removalFee > 0) {
            rowsHtml += createRow(
                'Removal',
                '',
                ui.f2.removalQty || 0,
                summaryData.removalFee,
                ui.f2.removalFeeExcluded ? 0 : summaryData.removalFee,
                ui.f2.removalFeeExcluded
            );
        }

        return { html: rowsHtml, subtotal };
    }

    /**
     * [NEW] Prepares the full HTML <table> string for the Roller Blinds appendix.
     * @returns {string}
     */
    _preparePage2RollerBlindsTable(quoteData, ui, mulTimes) {
        const items = this._getItems();
        const validItems = items.filter((i) => i.width && i.height);
        if (validItems.length === 0) return '';

        const mul = typeof mulTimes === 'number' ? mulTimes : 1;

        const bodyRows = validItems
            .map((item, index) => {
                const rowClass = this._getFabricRowClass(item);
                const fabricName =
                    item.fabric ||
                    this.configManager.getPriceMatrix(item.fabricType)?.name ||
                    '';
                const calculatedPrice = (item.linePrice || 0) * mul;

                return `
                <tr>
                    <td class="text-center">${index + 1}</td>
                    <td class="${rowClass}">${fabricName}</td>
                    <td class="${rowClass}">${item.color || ''}</td>
                    <td>${item.location || ''}</td>
                    <td class="text-center">${item.winder === 'HD' ? '✓' : ''}</td>
                    <td class="text-center">${item.dual === 'D' ? '✓' : ''}</td>
                    <td class="text-center">${item.motor ? '✓' : ''}</td>
                    <td class="text-right">${this._formatCurrency(calculatedPrice)}</td>
                </tr>
            `;
            })
            .join('');

        const subtotal = validItems.reduce(
            (sum, item) => sum + (item.linePrice || 0) * mul,
            0
        );

        return `
            <table class="detailed-list-table">
                <thead>
                    <tr><th colspan="8" class="text-center table-title">Roller Blinds</th></tr>
                    <tr>
                        <th class="text-center">NO</th>
                        <th>Name</th>
                        <th>Color</th>
                        <th>Location</th>
                        <th class="text-center">HD</th>
                        <th class="text-center">Dual</th>
                        <th class="text-center">Motor</th>
                        <th class="text-right">Price</th>
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="7" class="text-right"><strong>Sub total</strong></td>
                        <td class="text-right">${this._formatCurrency(subtotal)}</td>
                    </tr>
                </tfoot>
            </table>
        `;
    }

    /**
     * [NEW] Prepares the full HTML <table> string for the Motorised Accessories appendix.
     * @returns {string}
     */
    _preparePage2MotorisedTable(ui) {
        const f1State = ui.f1;
        const motorPrice = ui.driveMotorTotalPrice || 0;
        const remote1chPrice = this.calculationService.calculateF1ComponentPrice(
            'remote-1ch',
            f1State.remote_1ch_qty
        );
        const remote16chPrice =
            this.calculationService.calculateF1ComponentPrice(
                'remote-16ch',
                f1State.remote_16ch_qty
            );
        const chargerPrice = ui.driveChargerTotalPrice || 0;
        const cordPrice = ui.driveCordTotalPrice || 0;

        const totalMotorisedPrice =
            motorPrice +
            remote1chPrice +
            remote16chPrice +
            chargerPrice +
            cordPrice;
        if (totalMotorisedPrice === 0) return '';

        let bodyHtml = '';
        if (motorPrice > 0) {
            bodyHtml += `<tr><td>Motor</td><td class="text-center">${
                ui.driveMotorTotalPrice /
                this.calculationService.calculateF1ComponentPrice('motor', 1)
            }</td><td class="text-right">${this._formatCurrency(
                motorPrice
            )}</td></tr>`;
        }
        if (remote1chPrice > 0) {
            bodyHtml += `<tr><td>Remote</td><td class="text-center">${
                f1State.remote_1ch_qty
            } x 1 CH</td><td class="text-right">${this._formatCurrency(
                remote1chPrice
            )}</td></tr>`;
        }
        if (remote16chPrice > 0) {
            bodyHtml += `<tr><td>Remote</td><td class="text-center">${
                f1State.remote_16ch_qty
            } x 16 CH</td><td class="text-right">${this._formatCurrency(
                remote16chPrice
            )}</td></tr>`;
        }
        if (chargerPrice > 0) {
            bodyHtml += `<tr><td>Charger</td><td class="text-center">${
                ui.driveChargerCount
            }</td><td class="text-right">${this._formatCurrency(
                chargerPrice
            )}</td></tr>`;
        }
        if (cordPrice > 0) {
            bodyHtml += `<tr><td>3M Cord</td><td class="text-center">${
                ui.driveCordCount
            }</td><td class="text-right">${this._formatCurrency(
                cordPrice
            )}</td></tr>`;
        }

        return `
            <div class="table-scroll-wrapper">
                <table class="detailed-list-table">
                    <thead>
                        <tr><th colspan="3" class="text-center table-title">Motorised Accessories</th></tr>
                        <tr><th>Item</th><th class="text-center">Details / QTY</th><th class="text-right">Total Price</th></tr>
                    </thead>
                    <tbody>${bodyHtml}</tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td colspan="2" class="text-right"><strong>Total</strong></td>
                            <td class="text-right">${this._formatCurrency(totalMotorisedPrice)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    }

    _getF3OverrideData() {
        const getValue = (id) => document.getElementById(id)?.value || '';
        return {
            quoteId: getValue('f3-quote-id'),
            issueDate: getValue('f3-issue-date'),
            dueDate: getValue('f3-due-date'),
            customerName: getValue('f3-customer-name'),
            customerAddress: getValue('f3-customer-address'),
            customerPhone: getValue('f3-customer-phone'),
            customerEmail: getValue('f3-customer-email'),
            finalOfferPrice: getValue('f3-final-offer-price'),
            generalNotes: getValue('f3-general-notes'),
            termsConditions: getValue('f3-terms-conditions'),
        };
    }

    _formatCustomerInfo(f3Data) {
        let html = `<strong>${f3Data.customerName || 'Valued Customer'}</strong><br>`;
        if (f3Data.customerAddress) {
            html += `${f3Data.customerAddress.replace(/\n/g, '<br>')}<br>`;
        } else {
            html += 'Address to be provided<br>';
        }
        if (f3Data.customerPhone) html += `Phone: ${f3Data.customerPhone}<br>`;
        if (f3Data.customerEmail) html += `Email: ${f3Data.customerEmail}`;
        return html;
    }

    _populateTemplate(template, data) {
        return template.replace(/\{\{\{?(\w+)}}}?/g, (match, key) => {
            return data.hasOwnProperty(key) ? data[key] : match;
        });
    }

    // ... (The rest of the unchanged methods from the snapshot are omitted for brevity) ...

    handleRemoteDistribution() {
        const { ui } = this.stateService.getState();
        const totalRemoteCount = ui.driveRemoteCount || 0;

        const initial1ch = ui.f1.remote_1ch_qty;
        const initial16ch = (ui.f1.remote_16ch_qty === null) ? totalRemoteCount - initial1ch : ui.f1.remote_16ch_qty;

        this.eventAggregator.publish(EVENTS.SHOW_CONFIRMATION_DIALOG, {
            message: `Total remotes: ${totalRemoteCount}. Please distribute them.`,
            layout: [
                [
                    { type: 'text', text: '1-Ch Qty:', className: 'dialog-label' },
                    { type: 'input', id: DOM_IDS.DIALOG_INPUT_1CH, value: initial1ch },
                    { type: 'text', text: '16-Ch Qty:', className: 'dialog-label' },
                     { type: 'input', id: DOM_IDS.DIALOG_INPUT_16CH, value: initial16ch }
                ],
                [
                    {
                        type: 'button',
                         text: 'Confirm',
                        className: 'primary-confirm-button',
                        colspan: 2,
                        callback: () => {
                            const qty1ch = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_1CH).value, 10);
                             const qty16ch = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_16CH).value, 10);

                            if (isNaN(qty1ch) || isNaN(qty16ch) || qty1ch < 0 || qty16ch < 0) {
                                this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: 'Quantities must be positive numbers.', type: 'error' });
                                return false;
                            }

                            if (qty1ch + qty16ch !== totalRemoteCount) {
                                 this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                                    message: `Total must equal ${totalRemoteCount}. Current total: ${qty1ch + qty16ch}.`,
                                    type: 'error'
                                 });
                                return false;
                            }

                            this.stateService.dispatch(uiActions.setF1RemoteDistribution(qty1ch, qty16ch));
                            return true;
                        }
                    },
                    { type: 'button', text: 'Cancel', className: 'secondary', colspan: 2, callback: () => { } }
                 ]
            ],
             onOpen: () => {
                const input1ch = document.getElementById(DOM_IDS.DIALOG_INPUT_1CH);
                const input16ch = document.getElementById(DOM_IDS.DIALOG_INPUT_16CH);

                input1ch.addEventListener('input', () => {
                    const qty1ch = parseInt(input1ch.value, 10);
                    if (!isNaN(qty1ch) && qty1ch >= 0 && qty1ch <= totalRemoteCount) {
                         input16ch.value = totalRemoteCount - qty1ch;
                    }
                });

                input16ch.addEventListener('input', () => {
                    const qty16ch = parseInt(input16ch.value, 10);
                    if (!isNaN(qty16ch) && qty16ch >= 0 && qty16ch <= totalRemoteCount) {
                         input1ch.value = totalRemoteCount - qty16ch;
                    }
                });

                setTimeout(() => {
                    input1ch.focus();
                    input1ch.select();
                 }, 0);
            },
            closeOnOverlayClick: false
        });
    }

    handleDualDistribution() {
        const { quoteData, ui } = this.stateService.getState();
        const items = quoteData.products[quoteData.currentProduct].items;
        const totalDualPairs = Math.floor(items.filter(item => item.dual === 'D').length / 2);

        const initialCombo = (ui.f1.dual_combo_qty === null) ? totalDualPairs : ui.f1.dual_combo_qty;
        const initialSlim = (ui.f1.dual_slim_qty === null) ? 0 : ui.f1.dual_slim_qty;

        this.eventAggregator.publish(EVENTS.SHOW_CONFIRMATION_DIALOG, {
            message: `Total Dual pairs: ${totalDualPairs}. Please distribute them.`,
            layout: [
                 [
                    { type: 'text', text: 'Combo Qty:', className: 'dialog-label' },
                    { type: 'input', id: DOM_IDS.DIALOG_INPUT_COMBO, value: initialCombo },
                    { type: 'text', text: 'Slim Qty:', className: 'dialog-label' },
                    { type: 'input', id: DOM_IDS.DIALOG_INPUT_SLIM, value: initialSlim }
                 ],
                [
                    {
                        type: 'button',
                        text: 'Confirm',
                         className: 'primary-confirm-button',
                        colspan: 2,
                        callback: () => {
                            const qtyCombo = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_COMBO).value, 10);
                            const qtySlim = parseInt(document.getElementById(DOM_IDS.DIALOG_INPUT_SLIM).value, 10);

                            if (isNaN(qtyCombo) || isNaN(qtySlim) || qtyCombo < 0 || qtySlim < 0) {
                                this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: 'Quantities must be positive numbers.', type: 'error' });
                                return false;
                            }

                            if (qtyCombo + qtySlim !== totalDualPairs) {
                                 this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, {
                                    message: `Total must equal ${totalDualPairs}. Current total: ${qtyCombo + qtySlim}.`,
                                    type: 'error'
                                });
                                return false;
                            }

                            this.stateService.dispatch(uiActions.setF1DualDistribution(qtyCombo, qtySlim));
                            return true;
                        }
                    },
                    { type: 'button', text: 'Cancel', className: 'secondary', colspan: 2, callback: () => { } }
                ]
            ],
             onOpen: () => {
                const inputCombo = document.getElementById(DOM_IDS.DIALOG_INPUT_COMBO);
                const inputSlim = document.getElementById(DOM_IDS.DIALOG_INPUT_SLIM);

                inputSlim.addEventListener('input', () => {
                    const qtySlim = parseInt(inputSlim.value, 10);
                    if (!isNaN(qtySlim) && qtySlim >= 0 && qtySlim <= totalDualPairs) {
                        inputCombo.value = totalDualPairs - qtySlim;
                    }
                });

                inputCombo.addEventListener('input', () => {
                    const qtyCombo = parseInt(inputCombo.value, 10);
                    if (!isNaN(qtyCombo) && qtyCombo >= 0 && qtyCombo <= totalDualPairs) {
                        inputSlim.value = totalDualPairs - qtyCombo;
                    }
                });

                setTimeout(() => {
                    inputSlim.focus();
                    inputSlim.select();
                }, 0);
            },
            closeOnOverlayClick: false
        });
    }

    handleF1TabActivation() {
        const { quoteData } = this.stateService.getState();
        const productStrategy = this.productFactory.getProductStrategy(quoteData.currentProduct);
        const { updatedQuoteData } = this.calculationService.calculateAndSum(quoteData, productStrategy);

        this.stateService.dispatch(quoteActions.setQuoteData(updatedQuoteData));
    }

    handleF2TabActivation() {
        const { quoteData } = this.stateService.getState();
        const productStrategy = this.productFactory.getProductStrategy(quoteData.currentProduct);
        const { updatedQuoteData } = this.calculationService.calculateAndSum(quoteData, productStrategy);

        this.stateService.dispatch(quoteActions.setQuoteData(updatedQuoteData));

        this.detailConfigView.driveAccessoriesView.recalculateAllDriveAccessoryPrices();
        this.detailConfigView.dualChainView._calculateAndStoreDualPrice();

        this._calculateF2Summary();

        this.eventAggregator.publish(EVENTS.FOCUS_ELEMENT, { elementId: 'f2-b10-wifi-qty' });
    }

    handleNavigationToDetailView() {
        const { ui } = this.stateService.getState();
        if (ui.currentView === 'QUICK_QUOTE') {
            this.stateService.dispatch(uiActions.setCurrentView('DETAIL_CONFIG'));
            this.detailConfigView.activateTab('k1-tab');
        } else {
             this.stateService.dispatch(uiActions.setCurrentView('QUICK_QUOTE'));
            this.stateService.dispatch(uiActions.setVisibleColumns(initialState.ui.visibleColumns));
        }
    }

    handleNavigationToQuickQuoteView() {
        this.stateService.dispatch(uiActions.setCurrentView('QUICK_QUOTE'));
        this.stateService.dispatch(uiActions.setVisibleColumns(initialState.ui.visibleColumns));
    }

    handleTabSwitch({ tabId }) {
        this.detailConfigView.activateTab(tabId);
    }

    handleUserRequestedLoad() {
        const { quoteData } = this.stateService.getState();
        const productKey = quoteData.currentProduct;
        const items = quoteData.products[productKey] ? quoteData.products[productKey].items : [];
        const hasData = items.length > 1 || (items.length === 1 && (items[0].width || items[0].height));

        if (hasData) {
            this.eventAggregator.publish(EVENTS.SHOW_LOAD_CONFIRMATION_DIALOG);
        } else {
            this.eventAggregator.publish(EVENTS.TRIGGER_FILE_LOAD);
        }
    }

    handleLoadDirectly() {
        this.eventAggregator.publish(EVENTS.TRIGGER_FILE_LOAD);
    }

    handleFileLoad({ fileName, content }) {
        const result = this.fileService.parseFileContent(fileName, content);
        if (result.success) {
            this.stateService.dispatch(quoteActions.setQuoteData(result.data));
            this.stateService.dispatch(uiActions.resetUi());
            this.stateService.dispatch(uiActions.setSumOutdated(true));
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message });
        } else {
            this.eventAggregator.publish(EVENTS.SHOW_NOTIFICATION, { message: result.message, type: 'error' });
        }
    }

    handleF1DiscountChange({ percentage }) {
        this.stateService.dispatch(uiActions.setF1DiscountPercentage(percentage));
    }

    handleToggleFeeExclusion({ feeType }) {
        this.stateService.dispatch(uiActions.toggleF2FeeExclusion(feeType));
        this._calculateF2Summary();
    }

    handleF2ValueChange({ id, value }) {
        const numericValue = value === '' ? null : parseFloat(value);
        let keyToUpdate = null;

        switch (id) {
            case 'f2-b10-wifi-qty': keyToUpdate = 'wifiQty'; break;
            case 'f2-b13-delivery-qty': keyToUpdate = 'deliveryQty'; break;
            case 'f2-b14-install-qty': keyToUpdate = 'installQty'; break;
            case 'f2-b15-removal-qty': keyToUpdate = 'removalQty'; break;
            case 'f2-b17-mul-times': keyToUpdate = 'mulTimes'; break;
            case 'f2-b18-discount': keyToUpdate = 'discount'; break;
        }

        if (keyToUpdate) {
            this.stateService.dispatch(uiActions.setF2Value(keyToUpdate, numericValue));
            this._calculateF2Summary();
        }
    }

    focusNextF2Input(currentId) {
        const currentIndex = this.f2InputSequence.indexOf(currentId);
        if (currentIndex > -1 && currentIndex < this.f2InputSequence.length - 1) {
            const nextElementId = this.f2InputSequence[currentIndex + 1];
            this.eventAggregator.publish(EVENTS.FOCUS_ELEMENT, { elementId: nextElementId });
        } else {
            // If it's the last element, blur it.
            const currentElement = document.getElementById(currentId);
            currentElement?.blur();
        }
    }

    _calculateF2Summary() {
        const { quoteData, ui } = this.stateService.getState();
        const summaryValues = this.calculationService.calculateF2Summary(quoteData, ui);

        for (const key in summaryValues) {
            this.stateService.dispatch(uiActions.setF2Value(key, summaryValues[key]));
        }
    }
}